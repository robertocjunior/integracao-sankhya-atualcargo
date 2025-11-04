import { config } from './config/index.js';
import logger from './utils/logger.js';
import { delay } from './utils/helpers.js';
import { TokenError, AtualcargoTokenError, SankhyaTokenError } from './utils/errors.js';

import * as atualcargo from './services/atualcargo.service.js';
import * as sankhya from './services/sankhya.service.js';

// --- Gerenciamento de Estado das Sessões ---
let atualcargoToken = null;
let sankhyaSessionId = null;

// [!!] MUDANÇA AQUI: Cache para os dados da Atualcargo
let cachedVehiclePositions = null;

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
    logger.info('Sessão Sankhya ausente. Solicitando novo login...');
    sankhyaSessionId = await sankhya.loginSankhya();
  }
}

/**
 * ETAPA 1: Busca dados da Atualcargo (se o cache estiver vazio).
 */
async function runAtualcargoStep() {
  // Se já temos dados no cache, pulamos a busca
  if (cachedVehiclePositions) {
    logger.info('Usando posições do cache. Pulando busca na Atualcargo.');
    return;
  }
  
  logger.info('Cache de posições vazio. Buscando na Atualcargo...');
  await ensureAtualcargoToken();
  const vehiclePositions = await atualcargo.getAtualcargoPositions(atualcargoToken);

  if (!vehiclePositions || vehiclePositions.length === 0) {
    logger.info('Nenhuma posição de veículo recebida. Encerrando ciclo.');
    // Deixa o cache como nulo e o ciclo principal vai esperar 5 min.
    return;
  }

  // Salva os dados no cache para a próxima etapa
  cachedVehiclePositions = vehiclePositions;
}

/**
 * ETAPA 2: Processa e salva os dados no Sankhya (usando o cache).
 */
async function runSankhyaStep() {
  // Se o cache está vazio (porque a etapa 1 falhou ou não retornou dados),
  // não há nada para processar.
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

  // Bloco Try/Catch focado APENAS no Sankhya
  try {
    await ensureSankhyaSession();
    const vehicleMap = await sankhya.getSankhyaVehicleCodes(sankhyaSessionId, plates);
    const lastTimestamps = await sankhya.getLastRecordedTimestamps(sankhyaSessionId);
    
    await sankhya.savePositionsToSankhya(
      sankhyaSessionId, 
      cachedVehiclePositions, 
      vehicleMap,
      lastTimestamps
    );
    
    // [!!] SUCESSO [!!]
    // Se tudo deu certo, limpamos o cache para forçar uma nova busca da Atualcargo
    // no próximo ciclo de 5 minutos.
    logger.info('Dados salvos no Sankhya com sucesso. Limpando cache.');
    cachedVehiclePositions = null;

  } catch (error) {
    // [!!] FALHA NO SANKHYA [!!]
    // Se o Sankhya falhar, lançamos o erro para o loop principal
    // MAS **NÃO LIMPAMOS O CACHE**.
    logger.error(`Falha na etapa do Sankhya: ${error.message}`);
    if (error instanceof SankhyaTokenError) {
      sankhyaSessionId = null; // Força re-login do Sankhya
    }
    // Re-lança o erro para o catch principal do startApp
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
      // [!!] MUDANÇA AQUI: O ciclo agora é dividido em duas etapas
      
      // ETAPA 1: Busca na Atualcargo (só executa se o cache estiver vazio)
      await runAtualcargoStep();

      // ETAPA 2: Processa no Sankhya (só executa se o cache tiver dados)
      await runSankhyaStep();
      
      // Se ambas as etapas (ou as que precisavam rodar) terminaram sem erros:
      // Aguarda os 5 minutos (300s) para o próximo ciclo completo.
      logger.info('--- Ciclo de integração concluído ---');
      logger.info(`Aguardando ${config.cycle.waitBetweenCyclesMs / 1000}s para o próximo ciclo...`);
      await delay(config.cycle.waitBetweenCyclesMs);

    } catch (error) {
      // [!!] MUDANÇA AQUI: Tratamento de erros
      logger.error(`Erro grave no ciclo: ${error.message}`, error);

      // Se o erro foi na API da ATUALCARGO
      if (error instanceof AtualcargoTokenError) {
        logger.warn('Forçando re-login da Atualcargo no próximo ciclo.');
        atualcargoToken = null;
        cachedVehiclePositions = null; // Falha ao buscar, limpa o cache
      
      } else if (error instanceof SankhyaTokenError) {
        // Se o erro foi no SANKHYA, o token já foi limpo no runSankhyaStep.
        // O cache NÃO é limpo.
        logger.warn('Falha no Sankhya. O token será renovado e os dados do cache serão reprocessados.');
      
      } else {
        // Erro inesperado (500, 504, 425, ECONNRESET, etc.)
        // Limpa tudo por segurança para forçar uma atualização completa.
        logger.warn('Erro inesperado. Limpando todos os tokens e cache por segurança.');
        atualcargoToken = null;
        sankhyaSessionId = null;
        cachedVehiclePositions = null;
      }

      // Aguarda o tempo de erro (90s) antes de tentar o ciclo novamente.
      // Se o erro foi no Sankhya, o próximo ciclo vai pular a etapa 1 e ir direto para a 2.
      logger.info(`Aguardando ${config.cycle.waitAfterErrorMs / 1000}s antes de tentar novamente...`);
      await delay(config.cycle.waitAfterErrorMs);
    }
  }
}