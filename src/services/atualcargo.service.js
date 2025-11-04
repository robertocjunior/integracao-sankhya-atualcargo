import axios from 'axios';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { AtualcargoTokenError } from '../utils/errors.js';

// [!!] MUDANÇA AQUI: importando o 'timeout' da config
const { url, apiKey, username, password, timeout: positionTimeout } = config.atualcargo;

/**
 * Realiza login na API da Atualcargo.
 * @returns {Promise<string>} O token de acesso
 */
export async function loginAtualcargo() {
  logger.info('Tentando login na Atualcargo...');
  try {
    const response = await axios.post(
      `${url}/api/auth/v1/login`,
      { username, password },
      {
        headers: {
          'access-key': apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    // [!!] MUDANÇA AQUI: O token está na raiz da resposta
    if (response.data?.token) {
      logger.info('Login na Atualcargo bem-sucedido.');
      return response.data.token; // [!!] MUDANÇA AQUI
    }

    logger.error('Falha no login da Atualcargo: Token não encontrado.', response.data);
    throw new Error('Token não retornado pela API Atualcargo');

  } catch (error) {
    logger.error(`Erro crítico ao fazer login na Atualcargo: ${error.message}`);
    throw new Error(`Falha no login da Atualcargo: ${error.message}`);
  }
}

/**
 * Busca as últimas posições dos veículos na Atualcargo.
 * @param {string} token - O token Bearer
 * @returns {Promise<Array<Object>>} Uma lista de posições de veículos
 */
export async function getAtualcargoPositions(token) {
  logger.info('Buscando últimas posições da Atualcargo (pode demorar até 2 min)...');
  try {
    const response = await axios.get(`${url}/api/positions/v1/last`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'access-key': apiKey,
      },
      // [!!] MUDANÇA AQUI: Timeout estendido para a API
      timeout: positionTimeout,
    });

    if (response.data?.code === 200 && Array.isArray(response.data.data)) {
      logger.info(`Encontradas ${response.data.data.length} posições.`);
      return response.data.data; // Retorna o array de posições
    }

    logger.warn('Resposta inesperada da API de posições:', response.data);
    return [];

  } catch (error) {
    // [!!] MUDANÇA AQUI: Tratar erro de timeout
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      logger.error('Timeout ao buscar posições da Atualcargo. A API demorou mais que o esperado.');
      throw new Error('Timeout da API da Atualcargo excedido.');
    }

    if (error.response?.status === 401 || error.response?.status === 403) {
      logger.warn('Token da Atualcargo expirou (401/403).');
      // Lança um erro específico para o orquestrador tratar
      throw new AtualcargoTokenError('Token da Atualcargo expirado.');
    }
    logger.error(`Erro ao buscar posições da Atualcargo: ${error.message}`);
    throw new Error(`Falha ao buscar posições: ${error.message}`);
  }
}