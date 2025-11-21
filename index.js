import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs'; // NOVO: File System para ler os logs

import logger from './src/utils/logger.js';
import { appConfig, jobsConfig } from './src/config/index.js';
import { createJobLoop } from './src/jobs/job.scheduler.js';
import statusManager from './src/utils/statusManager.js';

// Jobs
import * as atualcargoJob from './src/jobs/atualcargo.job.js';
import * as sitraxJob from './src/jobs/sitrax.job.js';
import * as positronJob from './src/jobs/positron.job.js'; // NOVO: Importa o job Positron

// --- Workaround para __dirname em ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, 'logs'); // NOVO: Caminho para a pasta de logs

// --- Capturadores Globais ---
process.on('uncaughtException', (error) => {
  logger.error('Erro não capturado (uncaughtException):', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Rejeição de Promise não tratada (unhandledRejection):', reason);
});

// --- 1. Inicializar Servidor Web e Socket.io ---
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

statusManager.init(io);
app.use(express.static(path.join(__dirname, 'public')));

// --- 2. (NOVO) Middleware de Autenticação para Logs ---
const checkLogToken = (req, res, next) => {
  const { token } = req.query;
  if (!token || token !== appConfig.logToken) {
    logger.warn(`[Monitor] Tentativa de acesso aos logs falhou. IP: ${req.ip}`);
    return res.status(403).json({ error: 'Acesso negado. Token inválido.' });
  }
  next();
};

// --- 3. (NOVAS) Rotas da API de Logs ---

// Rota para LISTAR os arquivos de log
app.get('/api/logs', checkLogToken, async (req, res) => {
  try {
    const files = await fs.promises.readdir(LOG_DIR);
    // Filtra para enviar apenas arquivos .log ou .gz (logs comprimidos)
    const logFiles = files.filter(file => file.endsWith('.log') || file.endsWith('.gz'));
    res.json(logFiles.sort().reverse()); // Envia os mais recentes primeiro
  } catch (err) {
    logger.error('[Monitor] Erro ao listar diretório de logs:', err);
    res.status(500).json({ error: 'Erro ao ler diretório de logs.' });
  }
});

// Rota para FAZER O DOWNLOAD de um arquivo de log
app.get('/api/download/:filename', checkLogToken, (req, res) => {
  const { filename } = req.params;
  
  // Medida de segurança (Path Traversal)
  const safePath = path.join(LOG_DIR, path.basename(filename));
  if (!safePath.startsWith(LOG_DIR)) {
    return res.status(400).send('Tentativa de acesso inválida.');
  }

  res.download(safePath, (err) => {
    if (err) {
      logger.error(`[Monitor] Falha ao baixar o log "${filename}":`, err);
      if (!res.headersSent) {
        res.status(404).send('Arquivo não encontrado.');
      }
    }
  });
});

// --- 4. Rotas Públicas do Painel ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
});
app.get('/status', (req, res) => {
  res.json(statusManager.getStatus());
});

// --- 5. Inicialização ---
io.on('connection', (socket) => {
  logger.info(`[Monitor] Novo cliente conectado: ${socket.id}`);
  socket.emit('status-update', statusManager.getStatus());
});

httpServer.listen(appConfig.monitorPort, () => {
  logger.info(`[Serviço] Hub de Integração iniciado.`);
  logger.info(`[Monitor] Painel de monitoramento rodando em http://localhost:${appConfig.monitorPort}`);
  
  if (jobsConfig.atualcargo.enabled) {
    createJobLoop('Atualcargo', atualcargoJob.run, jobsConfig.atualcargo.interval);
  }
  if (jobsConfig.sitrax.enabled) {
    createJobLoop('Sitrax', sitraxJob.run, jobsConfig.sitrax.interval);
  }
  if (jobsConfig.positron.enabled) {
    createJobLoop('Positron', positronJob.run, jobsConfig.positron.interval);
  }
});