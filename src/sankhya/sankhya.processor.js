import { createLogger } from '../utils/logger.js';
import * as sankhyaApi from './sankhya.api.js';
import { isNewer } from '../utils/dateTime.js';
import { appConfig } from '../config/index.js';

const logger = createLogger('SankhyaProcessor');

const { sankhyaRetryLimit, sankhyaRetryDelay } = appConfig;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Processa um lote de dados de veículos e iscas no Sankhya.
 * @param {Array<Object>} standardPositions - Dados já mapeados
 * @param {string} sourceName - Nome da fonte (ex: 'Atualcargo')
 * @param {string} sankhyaUrl - A URL (principal/contingência) a ser usada
 * @param {string} iscaFabricanteId - O ID do fabricante para este lote de iscas
 */
export async function processPositions(standardPositions, sourceName, sankhyaUrl, iscaFabricanteId) {
  
  // 1. Separa veículos de iscas
  const vehicles = standardPositions.filter(p => p.type === 'vehicle');
  const iscas = standardPositions.filter(p => p.type === 'isca');
  
  logger.info(`[${sourceName}] Processando ${vehicles.length} veículos e ${iscas.length} iscas no Sankhya em ${sankhyaUrl}`);

  // 2. Obter dados de mapeamento e históricos do Sankhya
  const vehiclePlates = vehicles.map((v) => v.identifier);
  const iscaNumbers = iscas.map((i) => i.identifier);

  // CORREÇÃO CRÍTICA DE CONCORRÊNCIA:
  // A API Sankhya rejeita múltiplas requisições DbExplorerSP.executeQuery simultâneas 
  // usando o mesmo JSessionID. Mudamos para chamadas sequenciais (await).
  
  // Chamada 1: Mapeamento de Veículos
  const vehicleMappingResult = await sankhyaApi.getVehiclesByPlate(vehiclePlates, sankhyaUrl);

  // Chamada 2: Mapeamento de Iscas
  const iscaMappingResult = await sankhyaApi.getIscasByNum(iscaNumbers, iscaFabricanteId, sankhyaUrl);
  
  // Chamada 3: Último Histórico de Veículos
  const vehicleHistoryResult = await sankhyaApi.getLastVehicleHistory(sankhyaUrl);
  
  // Chamada 4: Último Histórico de Iscas
  const iscaHistoryResult = await sankhyaApi.getLastIscaHistory(sankhyaUrl);

  const vehicleMap = new Map(vehicleMappingResult.map((v) => [v.PLACA, v.CODVEICULO]));
  const iscaMap = new Map(iscaMappingResult.map((i) => [i.NUMISCA, i.SEQUENCIA]));
  const lastVehicleHistory = new Map(vehicleHistoryResult.map((h) => [h.CODVEICULO, h.DATHOR]));
  const lastIscaHistory = new Map(iscaHistoryResult.map((h) => [h.SEQUENCIA, h.DATHOR]));

  logger.info(`[${sourceName}] ${vehicleMap.size} veículos e ${iscaMap.size} iscas mapeados.`);

  // 3. Filtrar registros novos (Veículos)
  const newVehicleRecords = [];
  for (const vehicle of vehicles) {
    const codveiculo = vehicleMap.get(vehicle.identifier);
    if (!codveiculo) {
      logger.debug(`[${sourceName}] Veículo ${vehicle.identifier} ignorado (não cadastrado no Sankhya).`);
      continue;
    }
    const lastDathor = lastVehicleHistory.get(codveiculo);
    if (isNewer(vehicle.date, lastDathor)) {
      newVehicleRecords.push({ ...vehicle, codveiculo });
    }
  }

  // 4. Filtrar registros novos (Iscas)
  const newIscaRecords = [];
  for (const isca of iscas) {
    const sequencia = iscaMap.get(isca.identifier);
    if (!sequencia) {
      logger.debug(`[${sourceName}] Isca ${isca.identifier} ignorada (não cadastrada no Sankhya).`);
      continue;
    }
    
    // ***** ESTA É A CORREÇÃO (Já existente, mas mantida) *****
    const lastDathor = lastIscaHistory.get(sequencia);
    
    if (isNewer(isca.date, lastDathor)) {
      newIscaRecords.push({ ...isca, sequencia });
    }
  }
  
  logger.info(`[${sourceName}] ${newVehicleRecords.length} novos veículos e ${newIscaRecords.length} novas iscas para inserir.`);

  // 5. Inserir no Sankhya (A inserção em lote pode ser paralela, mas mantemos sequencial para maior segurança)
  logger.info(`[${sourceName}] Iniciando inserção de dados no Sankhya...`);
  
  // Inserção sequencial
  await sankhyaApi.insertVehicleHistory(newVehicleRecords, sankhyaUrl);
  await sankhyaApi.insertIscaHistory(newIscaRecords, sankhyaUrl);

  logger.info(`[${sourceName}] Processamento Sankhya concluído com sucesso.`);
}