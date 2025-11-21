import axios from 'axios';
import { jobsConfig, appConfig } from '../config/index.js'; // Importa de index.js
import { createLogger } from '../utils/logger.js';
import { PositronTokenError } from '../utils/errors.js';

const logger = createLogger('PositronAPI');
// REMOVIDO: const config = jobsConfig.positron;
// REMOVIDO: const { timeout } = appConfig;


/**
 * Realiza login na API da Positron.
 * @returns {Promise<string>} O token de acesso
 */
export async function loginPositron() {
  const config = jobsConfig.positron; // Acesso movido para dentro da função
  logger.info('[Positron] Tentando login...');
  const loginUrl = `${config.url}/api/v1/auth/token`;
  try {
    const response = await axios.post(
      loginUrl,
      { login: config.login, password: config.password },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: appConfig.timeout, // Acesso direto a appConfig
      }
    );

    if (response.data?.token) {
      logger.info('[Positron] Login bem-sucedido.');
      return response.data.token;
    }

    logger.error('[Positron] Falha no login: Token não encontrado.', response.data);
    throw new Error('Token não retornado pela API Positron');

  } catch (error) {
    logger.error(`[Positron] Erro crítico ao fazer login: ${error.message}`);
    throw new Error(`Falha no login da Positron: ${error.message}`);
  }
}

/**
 * Busca as últimas posições na Positron.
 * @param {string} token - O token Bearer
 * @returns {Promise<Array<Object>>} Uma lista de posições de rastreadores
 */
export async function getPositronPositions(token) {
  const config = jobsConfig.positron; // Acesso movido para dentro da função
  logger.info('[Positron] Buscando últimas posições...');
  const positionsUrl = `${config.url}/api/v1/position/latest?withAddress=true`;
  try {
    const response = await axios.get(positionsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: appConfig.timeout, // Acesso direto a appConfig
    });

    if (response.data && Array.isArray(response.data)) {
      logger.info(`[Positron] Encontradas ${response.data.length} posições.`);
      return response.data; 
    }

    logger.warn('[Positron] Resposta inesperada da API de posições:', response.data);
    return [];

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.response?.status === 504) {
      logger.error('[Positron] Timeout ao buscar posições. A API demorou mais que o esperado.');
      throw new Error('Timeout da API da Positron excedido.');
    }
    if (error.response?.status === 401 || error.response?.status === 403) {
      logger.warn('[Positron] Token expirou (401/403).');
      throw new PositronTokenError('Token da Positron expirado.');
    }
    logger.error(`[Positron] Erro ao buscar posições: ${error.message}`);
    throw new Error(`Falha ao buscar posições da Positron: ${error.message}`);
  }
}