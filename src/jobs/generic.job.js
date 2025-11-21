import { createLogger } from '../utils/logger.js';
import { appConfig } from '../config/index.js';
import { delay } from '../utils/dateTime.js';
import { SankhyaTokenError, AtualcargoTokenError } from '../utils/errors.js';
import { createJobStateManager } from './job.scheduler.js';
import statusManager from '../utils/statusManager.js'; 

import * as genericConnector from '../connectors/generic.connector.js';
import * as sankhyaProcessor from '../sankhya/sankhya.processor.js';
import { mapToStandard } from '../sankhya/generic.mapper.js';

export function createGenericJob(blueprint, sankhyaConfig) {
    const JOB_NAME = blueprint.name;
    const logger = createLogger(`Job:${JOB_NAME}`);
    const state = createJobStateManager(JOB_NAME, { sankhya: sankhyaConfig, app: appConfig });
    const { connector: connectorConfig, mapper: mapperConfig, jobConfig } = blueprint;

    async function run() {
        try {
            // ETAPA 1: EXTRACT (Genérico)
            if (!state.getCache()) {
                statusManager.updateJobStatus(JOB_NAME, 'running', 'Cache vazio. Buscando na API...');
                logger.info('Cache de posições vazio. Buscando na API...');
                
                const positions = await genericConnector.getPositions(
                    JOB_NAME, 
                    connectorConfig, 
                    jobConfig.tokenExpirationMs
                );
                
                if (!positions || positions.length === 0) {
                    statusManager.updateJobStatus(JOB_NAME, 'idle', 'Nenhuma posição recebida.');
                    logger.info('Nenhuma posição recebida. Encerrando ciclo.');
                    return;
                }

                // ETAPA 1.5: TRANSFORM (Genérico)
                const standardData = mapToStandard(positions, mapperConfig, JOB_NAME);
                
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
                jobConfig.fabricanteId
            );
            
            state.handleSankhyaSuccess();
            state.clearCache(); 
            statusManager.updateJobStatus(JOB_NAME, 'idle', 'Ciclo concluído com sucesso.'); 

        } catch (error) {
            logger.error(`Erro no ciclo [${JOB_NAME}]: ${error.message}`);
            statusManager.updateJobStatus(JOB_NAME, 'error', error.message);

            if (error instanceof SankhyaTokenError) {
                logger.warn(`Erro de Token/Sessão Sankhya. O job tentará novamente com os mesmos dados.`);
            
            } else if (error instanceof AtualcargoTokenError) {
                logger.warn(`Erro de Token na ${JOB_NAME}. Limpando cache e forçando re-login.`);
                state.clearCache();
            
            } else if (error.message.includes(JOB_NAME) || error.message.includes('Timeout')) {
                logger.warn(`Erro de rede/Timeout na API ${JOB_NAME}. Limpando cache.`);
                state.clearCache();
            
            } else {
                state.handleSankhyaError(error);
            }

            logger.info(`Aguardando ${appConfig.jobRetryDelayMs / 1000}s antes de tentar o job novamente...`);
            await delay(appConfig.jobRetryDelayMs);
        }
    }
    
    return { run, interval: jobConfig.intervalMs };
}