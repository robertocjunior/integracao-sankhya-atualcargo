import { config } from './config/index.js';
import logger from './utils/logger.js';
import { delay } from './utils/helpers.js';
import { TokenError, AtualcargoTokenError, SankhyaTokenError } from './utils/errors.js';

import * as atualcargo from './services/atualcargo.service.js';
import * as sankhya from './services/sankhya.service.js';

// --- Gerenciamento de Estado das Sessões ---
let atualcargoToken = null;
let sankhyaSessionId = null;
let cachedVehiclePositions = null;

// --- Gerenciamento de contingência Sankhya ---
let currentSankhyaUrl = config.sankhya.url; // Começa com a URL principal
let primaryLoginAttempts = 0;
const MAX_PRIMARY_ATTEMPTS = 2; // Tenta 2 vezes no principal antes de ir para contingência

/**
 * Garante que temos um token válido da Atualcargo.
 */
async function ensureAtualcargoToken() {
  if (!atualcargoToken) {
    logger.info('Token da Atualcargo ausente. Solicitando novo login...');
    atualcargoToken = await atualcargo.loginAtualcargo();
    
    logger.info(`Aguardando ${config.cycle.waitAfterLoginMs / 1000}s após login...`);
    await delay(config.cycle.waitAfterLoginMs);
  }
}

/**
 * Garante que temos uma sessão válida do Sankhya.
 */
async function ensureSankhyaSession() {
  if (!sankhyaSessionId) {
    logger.info(`Sessão Sankhya ausente. Solicitando novo login em ${currentSankhyaUrl}...`);
    sankhyaSessionId = await sankhya.loginSankhya(currentSankhyaUrl);
    logger.info(`Login Sankhya bem-sucedido em: ${currentSankhyaUrl}`);
    
    if (currentSankhyaUrl === config.sankhya.url) {
        primaryLoginAttempts = 0;
    }
  }
}

/**
 * ETAPA 1: Busca dados da Atualcargo (se o cache estiver vazio).
 */
async function runAtualcargoStep() {
  if (cachedVehiclePositions) {
    logger.info('Usando posições do cache. Pulando busca na Atualcargo.');
    return;
  }
  
  logger.info('Cache de posições vazio. Buscando na Atualcargo...');
  await ensureAtualcargoToken();
  const vehiclePositions = await atualcargo.getAtualcargoPositions(atualcargoToken);

  if (!vehiclePositions || vehiclePositions.length === 0) {
    logger.info('Nenhuma posição de veículo recebida. Encerrando ciclo.');
    return;
  }

  cachedVehiclePositions = vehiclePositions;
}

/**
 * ETAPA 2: Processa e salva os dados no Sankhya (usando o cache).
 */
async function runSankhyaStep() {
  if (!cachedVehiclePositions) {
    logger.info('Cache de posições vazio. Pulando etapa do Sankhya.');
    return;
  }
  
  logger.info(`Processando ${cachedVehiclePositions.length} posições do cache para o Sankhya...`);
  
  const plates = [...new Set(cachedVehiclePositions.map(pos => pos.plate).filter(p => p))];
  if (plates.length === 0) {
    logger.info('Nenhuma placa válida nos dados do cache. Limpando cache.');
    cachedVehiclePositions = null;
    return;
  }

  try {
    await ensureSankhyaSession(); 

    const vehicleMap = await sankhya.getSankhyaVehicleCodes(sankhyaSessionId, plates, currentSankhyaUrl);
    const lastTimestamps = await sankhya.getLastRecordedTimestamps(sankhyaSessionId, currentSankhyaUrl);
    
    await sankhya.savePositionsToSankhya(
      sankhyaSessionId, 
      cachedVehiclePositions, 
      vehicleMap,
      lastTimestamps,
      currentSankhyaUrl
    );
    
    logger.info('Dados salvos no Sankhya com sucesso. Limpando cache.');
    cachedVehiclePositions = null;

  } catch (error) {
    logger.error(`Falha na etapa do Sankhya: ${error.message}`);
    if (error instanceof SankhyaTokenError) {
      sankhyaSessionId = null; 
    }
    throw error;
  }
}


/**
 * Inicia o loop principal do serviço.
 */
export async function startApp() {
  logger.info('Iniciando serviço de integração de rastreamento...');
  
  while (true) {
    try {
      await runAtualcargoStep();
      await runSankhyaStep();
      
      logger.info('--- Ciclo de integração concluído ---');
      logger.info(`Aguardando ${config.cycle.waitBetweenCyclesMs / 1000}s para o próximo ciclo...`);
      await delay(config.cycle.waitBetweenCyclesMs);

    } catch (error) {
      logger.error(`Erro grave no ciclo: ${error.message}`, error);

      // 1. Erro de Token/Auth da ATUALCARGO
      if (error instanceof AtualcargoTokenError) {
        logger.warn('Forçando re-login da Atualcargo no próximo ciclo.');
        atualcargoToken = null;
        cachedVehiclePositions = null;
      
      // 2. Erro de Token/Auth do SANKHYA
      } else if (error instanceof SankhyaTokenError) {
        logger.warn(`Erro de Token/Sessão Sankhya: ${error.message}`);
        sankhyaSessionId = null; 

        if (config.sankhya.contingencyUrl && currentSankhyaUrl === config.sankhya.contingencyUrl) {
          logger.warn('Acesso negado ou token expirou na contingência. Voltando para o principal.');
          currentSankhyaUrl = config.sankhya.url;
          primaryLoginAttempts = 0;
        } else {
          logger.error('Acesso negado no principal. O ciclo tentará novamente no principal.');
        }
      
      // 3. Erro Genérico (Rede, Timeout, 425, 500, etc.)
      } else {
        logger.warn(`Erro inesperado ou de rede: ${error.message}`);
        
        // [!!] LÓGICA CORRIGIDA [!!]
        // Verifica se o erro é da ATUALCARGO (usando toLowerCase para segurança)
        if (error.message.toLowerCase().includes('atualcargo')) {
            logger.warn('Erro de rede ou Rate Limit (425) na Atualcargo. Limpando token e cache.');
            atualcargoToken = null;
            cachedVehiclePositions = null;
        
        // Se não for da Atualcargo, é do SANKHYA (ou inesperado)
        } else {
            logger.warn('Erro de rede no Sankhya. Iniciando lógica de contingência.');
            sankhyaSessionId = null; // Força re-login

            if (config.sankhya.contingencyUrl) {
                if (currentSankhyaUrl === config.sankhya.url) {
                    primaryLoginAttempts++;
                    logger.info(`Falha de rede no principal. Tentativa ${primaryLoginAttempts}/${MAX_PRIMARY_ATTEMPTS}.`);
                    
                    if (primaryLoginAttempts >= MAX_PRIMARY_ATTEMPTS) {
                        logger.warn('Limite de falhas no principal atingido. Alternando para contingência.');
                        currentSankhyaUrl = config.sankhya.contingencyUrl;
                        primaryLoginAttempts = 0;
                    }
                } else {
                    logger.warn('Falha de rede na contingência. Tentando novamente na contingência.');
                }
            } else {
                logger.warn('Erro de rede no Sankhya, mas não há URL de contingência definida.');
            }
        }
      }

      logger.info(`Aguardando ${config.cycle.waitAfterErrorMs / 1000}s antes de tentar novamente...`);
      await delay(config.cycle.waitAfterErrorMs);
    }
  }
}