import axios from 'axios';
import { jobsConfig } from '../config/jobs.js';
import { appConfig } from '../config/app.js';
import { createLogger } from '../utils/logger.js';
import { PositronTokenError } from '../utils/errors.js';

const logger = createLogger('PositronAPI');
const config = jobsConfig.positron;
const { timeout } = appConfig;

// Função utilitária para unir a URL base com o endpoint de forma segura.
// Isso resolve o problema de barras duplas (//) que podem causar 404.
const joinUrl = (baseUrl, endpoint) => {
  const base = baseUrl.replace(/\/$/, ''); // Remove a barra final do base, se existir
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`; // Garante uma barra inicial no endpoint
  return `${base}${path}`;
};

const LOGIN_ENDPOINT = 'auth/token';
const POSITIONS_ENDPOINT = 'position/latest?withAddress=true';


/**
 * Realiza login na API da Positron.
 * @returns {Promise<{token: string, expires: number}>} O token e o timestamp de expiração
 */
export async function loginPositron() {
  logger.info('[Positron] Tentando login...');
  try {
    const loginUrl = joinUrl(config.url, LOGIN_ENDPOINT); // Usa a função de união segura

    const response = await axios.post(
      loginUrl, 
      { login: config.login, password: config.password },
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: timeout,
      }
    );

    const data = response.data;
    if (data?.token && data?.expires) {
      const expiryTimestamp = new Date(data.expires).getTime();
      logger.info(`[Positron] Login bem-sucedido. Token expira em: ${new Date(expiryTimestamp).toLocaleString()}`);
      return { token: data.token, expires: expiryTimestamp };
    }

    logger.error('[Positron] Falha no login: Token/Expiração não encontrados.', response.data);
    throw new Error('Token ou data de expiração não retornados pela API Positron');

  } catch (error) {
    if (error.response?.status === 401 || error.response?.status === 400) {
      logger.error('[Positron] Falha de autenticação (401/400).');
      throw new PositronTokenError('Falha de autenticação na Positron.');
    }
    
    const status = error.response?.status || 'desconhecido';
    logger.error(`[Positron] Erro crítico ao fazer login: ${error.message} (Status: ${status})`);
    throw new Error(`Falha no login da Positron: ${error.message}`);
  }
}

/**
 * Busca as últimas posições dos veículos na Positron.
 * @param {string} token - O token Bearer
 * @returns {Promise<Array<Object>>} Uma lista de posições de veículos
 */
export async function getPositronPositions(token) {
  logger.info('[Positron] Buscando últimas posições...');
  try {
    const positionsUrl = joinUrl(config.url, POSITIONS_ENDPOINT); // Usa a função de união segura

    const response = await axios.get(positionsUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      timeout: timeout, 
    });

    if (response.data && Array.isArray(response.data)) {
      logger.info(`[Positron] Encontradas ${response.data.length} posições.`);
      return response.data; 
    }

    logger.warn('[Positron] Resposta inesperada da API de posições:', response.data);
    return [];

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      logger.error('[Positron] Timeout ao buscar posições.');
      throw new Error('Timeout da API da Positron excedido.');
    }
    if (error.response?.status === 401) {
      logger.warn('[Positron] Token expirou (401).');
      throw new PositronTokenError('Token da Positron expirado.');
    }
    
    const status = error.response?.status || 'desconhecido';
    logger.error(`[Positron] Erro ao buscar posições: ${error.message} (Status: ${status})`);
    throw new Error(`Falha ao buscar posições da Positron: ${error.message}`);
  }
}