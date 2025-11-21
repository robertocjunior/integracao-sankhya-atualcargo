import { createLogger } from '../utils/logger.js';
import { jobsConfig, sankhyaConfig, appConfig } from '../config/index.js';
import { delay } from '../utils/dateTime.js';
import { PositronTokenError, SankhyaTokenError } from '../utils/errors.js';
import { createJobStateManager } from './job.scheduler.js';
import statusManager from '../utils/statusManager.js'; 

import * as positronApi from '../connectors/positron.connector.js';
import * as sankhyaProcessor from '../sankhya/sankhya.processor.js';
import { mapPositronToStandard } from '../sankhya/sankhya.mapper.js';

const config = jobsConfig.positron;
const JOB_NAME = 'Positron';
const logger = createLogger(`Job:${JOB_NAME}`);

let token = null;
let tokenTimestamp = null;
const state = createJobStateManager(JOB_NAME, { sankhya: sankhyaConfig, app: appConfig });

/**
 * Garante que o token de autenticação da Positron esteja válido.
 */
async function ensurePositronToken() {
  const now = Date.now();
  if (tokenTimestamp && (now - tokenTimestamp > config.tokenExpirationMs)) {
    logger.info(`Token expirou (limite de ${config.tokenExpirationMs / 60000} min). Forçando renovação.`);
    token = null;
    tokenTimestamp = null;
  }
  
  if (!token) {
    statusManager.updateJobStatus(JOB_NAME, 'running', 'Autenticando na API Positron...');
    logger.info('Token ausente ou expirado. Solicitando novo login...');
    token = await positronApi.loginPositron();
    tokenTimestamp = Date.now();
  }
}

export async function run() {
  try {
    // ETAPA 1: EXTRACT
    if (!state.getCache()) {
      statusManager.updateJobStatus(JOB_NAME, 'running', 'Cache vazio. Buscando na API...');
      logger.info('Cache de posições vazio. Buscando na API...');
      await ensurePositronToken();
      
      statusManager.updateJobStatus(JOB_NAME, 'running', 'Buscando posições na API...');
      const positions = await positronApi.getPositronPositions(token);
      
      if (!positions || positions.length === 0) {
        statusManager.updateJobStatus(JOB_NAME, 'idle', 'Nenhuma posição recebida.');
        logger.info('Nenhuma posição de isca recebida. Encerrando ciclo.');
        return; 
      }

      const standardData = mapPositronToStandard(positions);
      state.setCache(standardData);
      statusManager.updateJobStatus(JOB_NAME, 'running', `${standardData.length} posições salvas no cache.`);
      logger.info(`Dados salvos no cache: ${standardData.length} posições.`);
    } else {
      statusManager.updateJobStatus(JOB_NAME, 'running', 'Usando dados do cache (retentativa).');
      logger.info('Usando posições do cache. Pulando busca na API.');
    }

    // ETAPA 2: LOAD (Sankhya)
    const cachedData = state.getCache();
    if (!cachedData || cachedData.length === 0) {
      statusManager.updateJobStatus(JOB_NAME, 'idle', 'Cache vazio.');
      logger.info('Cache de posições vazio. Pulando etapa do Sankhya.');
      return;
    }
    
    statusManager.updateJobStatus(JOB_NAME, 'running', `Processando ${cachedData.length} posições no Sankhya...`);
    await sankhyaProcessor.processPositions(
      cachedData,
      JOB_NAME,
      state.sankhyaUrl,
      config.fabricanteId
    );
    
    state.handleSankhyaSuccess(); 
    state.clearCache(); 
    statusManager.updateJobStatus(JOB_NAME, 'idle', 'Ciclo concluído com sucesso.'); // Seta o status final

  } catch (error) {
    logger.error(`Erro no ciclo [${JOB_NAME}]: ${error.message}`);
    statusManager.updateJobStatus(JOB_NAME, 'error', error.message); // Seta o status de erro

    if (error instanceof PositronTokenError) {
      logger.warn('Forçando re-login da Positron no próximo ciclo.');
      token = null;
      tokenTimestamp = null;
      state.clearCache(); 
    
    } else if (error instanceof SankhyaTokenError) {
      logger.warn(`Erro de Token/Sessão Sankhya. O job tentará novamente com os mesmos dados.`);
    
    } else if (error.message.includes('Positron')) {
        logger.warn('Erro de rede ou Rate Limit na Positron. Limpando token e cache.');
        token = null;
        tokenTimestamp = null;
        state.clearCache();
    
    } else {
      state.handleSankhyaError(error);
    }

    logger.info(`Aguardando ${appConfig.jobRetryDelayMs / 1000}s antes de tentar o job novamente...`);
    await delay(appConfig.jobRetryDelayMs);
  }
}