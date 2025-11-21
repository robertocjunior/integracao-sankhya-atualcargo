import axios from 'axios';
import { appConfig } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { AtualcargoTokenError } from '../utils/errors.js';
import { getValue } from '../utils/mapper.utils.js';

const { timeout } = appConfig;
const loggers = new Map();
const tokenCache = new Map();

function getLogger(name) {
    if (!loggers.has(name)) {
        loggers.set(name, createLogger(`Connector:${name}`));
    }
    return loggers.get(name);
}

// --- Funções Auxiliares de Autenticação ---

async function performLogin(jobName, config) {
  const logger = getLogger(jobName);
  logger.info(`[${jobName}] Tentando login em ${config.baseUrl}${config.loginUrl}...`);
  
  try {
    const isPositron = config.type === 'POSITRON_TOKEN';
    
    // Corpo da requisição: Usa 'login' ou 'username' dependendo do tipo
    const loginBody = isPositron
        ? { login: config.username, password: config.password }
        : { username: config.username, password: config.password };

    // Headers para Login: Apenas Content-Type é sempre necessário.
    let headers = { 'Content-Type': 'application/json' };
    
    // Adiciona o access-key apenas para Atualcargo (se existir)
    if (config.type === 'ATUALCARGO' && config.apiKey) {
        headers['access-key'] = config.apiKey;
    }

    const response = await axios.post(
      `${config.baseUrl}${config.loginUrl}`,
      loginBody,
      {
        headers: headers,
        timeout: timeout,
      }
    );

    // O token pode estar no campo 'token' (Positron) ou 'data.token' (Atualcargo)
    const token = response.data?.token || response.data?.data?.token;

    if (token) {
      logger.info(`[${jobName}] Login bem-sucedido.`);
      tokenCache.set(jobName, {
          token: token,
          timestamp: Date.now(),
      });
      return token;
    }

    logger.error(`[${jobName}] Falha no login: Token não encontrado.`, response.data);
    throw new Error(`Token não retornado pela API ${jobName}`);

  } catch (error) {
    logger.error(`[${jobName}] Erro crítico ao fazer login: ${error.message}`);
    throw new Error(`Falha no login da ${jobName}: ${error.message}`);
  }
}

async function ensureToken(jobName, config) {
    const requiresToken = config.type === 'ATUALCARGO' || config.type === 'POSITRON_TOKEN';
    if (!requiresToken) return null; 

    const cache = tokenCache.get(jobName);
    const now = Date.now();
    
    if (cache && (now - cache.timestamp < config.tokenExpirationMs)) {
        return cache.token; 
    }

    return performLogin(jobName, config);
}

// --- Função Principal de Posições ---

export async function getPositions(jobName, connectorConfig, tokenExpirationMs) {
  const logger = getLogger(jobName);
  const { type, baseUrl, positionsUrl, positionsPath, apiKey, customBody, omitContentTypeHeader } = connectorConfig;
  
  let headers = { 'Content-Type': 'application/json' };
  let body = customBody;
  let method = 'post';

  const requiresToken = type === 'ATUALCARGO' || type === 'POSITRON_TOKEN';

  if (requiresToken) {
    method = 'get'; // GET para busca de posições
    const token = await ensureToken(jobName, { ...connectorConfig, tokenExpirationMs });

    // Headers base para APIs baseadas em Token
    headers = {
        'Authorization': `Bearer ${token}`,
    };
    
    // Adiciona o access-key apenas para Atualcargo
    if (type === 'ATUALCARGO' && apiKey) {
        headers['access-key'] = apiKey;
    }
    
    body = null;
  }
  
  // LÓGICA GENÉRICA PARA OMITIR CONTENT-TYPE (para GET requests)
  if (omitContentTypeHeader === true) {
      delete headers['Content-Type'];
  }

  logger.info(`[${jobName}] Buscando posições em ${baseUrl}${positionsUrl}...`);

  try {
    const response = await axios({
        method: method,
        url: positionsUrl,
        baseURL: baseUrl,
        headers: headers,
        data: body,
        timeout: timeout, 
    });

    // Usa getValue com "" para o caso da resposta ser um array na raiz (Positron)
    const positions = getValue(response.data, positionsPath) || response.data || [];

    if (Array.isArray(positions)) {
      logger.info(`[${jobName}] Encontradas ${positions.length} posições.`);
      return positions; 
    }

    logger.warn(`[${jobName}] Resposta inesperada da API. Caminho '${positionsPath}' não retornou array.`);
    return [];

  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.response?.status === 504) {
      logger.error(`[${jobName}] Timeout ao buscar posições.`);
      throw new Error(`Timeout da API da ${jobName} excedido.`);
    }

    if (requiresToken && (error.response?.status === 401 || error.response?.status === 403)) {
      logger.warn(`[${jobName}] Token expirou (401/403).`);
      tokenCache.delete(jobName); 
      throw new AtualcargoTokenError(`Token da ${jobName} expirado.`); // Reusa o erro Atualcargo
    }
    
    if (error.response?.status) {
        logger.error(`[${jobName}] Erro ${error.response.status} na API.`, error.response?.data);
        if (error.response?.status === 405) {
             logger.error(`[${jobName}] Erro 405 (Method Not Allowed). Verifique se o método é GET.`);
        }
    } else {
        logger.error(`[${jobName}] Erro de rede: ${error.message}`);
    }
    
    throw new Error(`Falha ao buscar posições da ${jobName}: ${error.message}`);
  }
}