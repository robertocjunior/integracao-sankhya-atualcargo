import { config } from './config/index.js';
import logger from './utils/logger.js';
import { delay } from './utils/helpers.js';
import { TokenError, AtualcargoTokenError, SankhyaTokenError } from './utils/errors.js';

import * as atualcargo from './services/atualcargo.service.js';
import * as sankhya from './services/sankhya.service.js';

// --- Gerenciamento de Estado das Sessões ---
let atualcargoToken = null;
let atualcargoTokenTimestamp = null;
let sankhyaSessionId = null;
let cachedVehiclePositions = null;

// --- Gerenciamento de contingência Sankhya ---
let currentSankhyaUrl = config.sankhya.url;
let primaryLoginAttempts = 0;
const MAX_PRIMARY_ATTEMPTS = 2;

/**
 * Garante que temos um token válido da Atualcargo.
 */
async function ensureAtualcargoToken() {
  const now = Date.now();
  if (atualcargoTokenTimestamp && (now - atualcargoTokenTimestamp > config.atualcargo.tokenExpirationMs)) {
    logger.info(`Token da Atualcargo expirou (limite de ${config.atualcargo.tokenExpirationMs / 60000} min). Forçando renovação.`);
    atualcargoToken = null;
    atualcargoTokenTimestamp = null;
  }
  
  if (!atualcargoToken) {
    logger.info('Token da Atualcargo ausente ou expirado. Solicitando novo login...');
    atualcargoToken = await atualcargo.loginAtualcargo();
    atualcargoTokenTimestamp = Date.now();
    
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
 * [MODIFICADO] ETAPA 2: Processa e salva os dados no Sankhya (usando o cache).
 * Agora separa Veículos (AD_LOCATCAR) de Iscas (AD_LOCATISC).
 */
async function runSankhyaStep() {
  if (!cachedVehiclePositions) {
    logger.info('Cache de posições vazio. Pulando etapa do Sankhya.');
    return;
  }
  
  logger.info(`Processando ${cachedVehiclePositions.length} posições totais do cache...`);

  // [NOVO] Separa veículos de iscas
  const vehiclePositions = cachedVehiclePositions.filter(p => p.plate && !p.plate.toUpperCase().startsWith('ISCA'));
  const iscaPositions = cachedVehiclePositions.filter(p => p.plate && p.plate.toUpperCase().startsWith('ISCA'));

  const vehiclePlates = [...new Set(vehiclePositions.map(pos => pos.plate))];
  const iscaPlates = [...new Set(iscaPositions.map(pos => pos.plate))];

  if (vehiclePlates.length === 0 && iscaPlates.length === 0) {
    logger.info('Nenhuma placa válida (veículo ou isca) nos dados do cache. Limpando cache.');
    cachedVehiclePositions = null;
    return;
  }

  try {
    await ensureSankhyaSession(); 

    // --- 1. Processa VEÍCULOS (AD_LOCATCAR) ---
    if (vehiclePositions.length > 0) {
      logger.info(`Processando ${vehiclePositions.length} posições de VEÍCULOS...`);
      const vehicleMap = await sankhya.getSankhyaVehicleCodes(sankhyaSessionId, vehiclePlates, currentSankhyaUrl);
      const lastVehicleTimestamps = await sankhya.getLastRecordedTimestamps(sankhyaSessionId, currentSankhyaUrl);
      
      await sankhya.savePositionsToSankhya(
        sankhyaSessionId, 
        vehiclePositions, 
        vehicleMap,
        lastVehicleTimestamps,
        currentSankhyaUrl
      );
    } else {
      logger.info('Nenhuma posição de VEÍCULO para processar.');
    }

    // --- 2. Processa ISCAS (AD_LOCATISC) ---
    if (iscaPositions.length > 0) {
      logger.info(`Processando ${iscaPositions.length} posições de ISCAS...`);
      // Nota: iscaPlates é o 'NUMISCA' que é o valor da 'plate' da API
      const iscaMap = await sankhya.getSankhyaIscaSequences(sankhyaSessionId, iscaPlates, currentSankhyaUrl);
      const lastIscaTimestamps = await sankhya.getLastIscaTimestamps(sankhyaSessionId, currentSankhyaUrl);
      
      await sankhya.saveIscaPositionsToSankhya(
        sankhyaSessionId,
        iscaPositions,
        iscaMap,
        lastIscaTimestamps,
        currentSankhyaUrl
      );
    } else {
      logger.info('Nenhuma posição de ISCA para processar.');
    }

    // --- 3. Sucesso ---
    logger.info('Dados (veículos e iscas) salvos no Sankhya com sucesso. Limpando cache.');
    cachedVehiclePositions = null;

  } catch (error) {
    logger.error(`Falha na etapa do Sankhya: ${error.message}`);
    // Se a sessão expirou (TokenError), invalida o ID para forçar novo login na próxima tentativa
    if (error instanceof SankhyaTokenError) {
      sankhyaSessionId = null; 
    }
    // Lança o erro para ser pego pelo loop principal, que aguardará o 'waitAfterErrorMs'
    // O cache *não* é limpo, garantindo a retentativa dos dados.
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
        atualcargoTokenTimestamp = null;
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
        
        if (error.message.toLowerCase().includes('atualcargo')) {
            logger.warn('Erro de rede ou Rate Limit (425) na Atualcargo. Limpando token e cache.');
            atualcargoToken = null;
            atualcargoTokenTimestamp = null;
            cachedVehiclePositions = null;
        
        } else {
            logger.warn('Erro de rede no Sankhya. Iniciando lógica de contingência.');
            sankhyaSessionId = null;

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