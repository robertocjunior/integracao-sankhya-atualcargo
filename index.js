import http from 'http';
import express from 'express';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises'; 
import yaml from 'js-yaml'; // Novo
import logger from './src/utils/logger.js';
import { appConfig, sankhyaConfig } from './src/config/index.js';
import { createJobLoop } from './src/jobs/job.scheduler.js';
import statusManager from './src/utils/statusManager.js';
import { createGenericJob } from './src/jobs/generic.job.js'; // Novo Job Genérico

// --- Workaround para __dirname em ES Modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, 'logs');
const BLUEPRINTS_DIR = path.join(__dirname, 'blueprints'); // Novo

// --- Capturadores Globais ---
process.on('uncaughtException', (error) => {
  logger.error('Erro não capturado (uncaughtException):', error);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Rejeição de Promise não tratada (unhandledRejection):', reason);
});

/**
 * Carrega, interpola e valida todos os blueprints.
 */
async function loadBlueprints() {
    const blueprints = [];
    try {
        const files = await fs.readdir(BLUEPRINTS_DIR);
        const yamlFiles = files.filter(file => file.endsWith('.yaml') || file.endsWith('.yml'));
        
        for (const file of yamlFiles) {
            const filePath = path.join(BLUEPRINTS_DIR, file);
            let content = await fs.readFile(filePath, 'utf8');
            
            // Interpolação de variáveis de ambiente (ENV) no Blueprint
            // Formato: ${VAR_NAME:DEFAULT_VALUE}
            content = content.replace(/\$\{([^}]+)\}/g, (match, key) => {
                const [varName, defaultValue] = key.split(':');
                return process.env[varName] || defaultValue || '';
            });

            const blueprint = yaml.load(content);
            
            if (blueprint.enabled === true) {
                if (!blueprint.name || !blueprint.jobConfig?.intervalMs || !blueprint.connector || !blueprint.mapper) {
                    logger.error(`Blueprint inválido: ${file}. Campos essenciais ausentes.`);
                    continue;
                }
                blueprints.push(blueprint);
                logger.info(`Blueprint [${blueprint.name}] carregado com sucesso.`);
            } else {
                logger.info(`Blueprint [${blueprint.name}] desabilitado.`);
            }
        }
    } catch (err) {
        if (err.code === 'ENOENT') {
            logger.warn(`Diretório de Blueprints não encontrado: ${BLUEPRINTS_DIR}.`);
        } else {
            logger.error('Erro ao carregar Blueprints:', err.message);
        }
    }
    return blueprints;
}

// --- 1. Inicializar Servidor Web e Socket.io (mantido) ---
const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

statusManager.init(io);
app.use(express.static(path.join(__dirname, 'public')));

// ... (2. Middleware de Autenticação, 3. Rotas de Logs, 4. Rotas Públicas - mantidas) ...
const checkLogToken = (req, res, next) => {
  const { token } = req.query;
  if (!token || token !== appConfig.logToken) {
    logger.warn(`[Monitor] Tentativa de acesso aos logs falhou. IP: ${req.ip}`);
    return res.status(403).json({ error: 'Acesso negado. Token inválido.' });
  }
  next();
};

app.get('/api/logs', checkLogToken, async (req, res) => {
  try {
    const files = await fs.readdir(LOG_DIR);
    const logFiles = files.filter(file => file.endsWith('.log') || file.endsWith('.gz'));
    res.json(logFiles.sort().reverse());
  } catch (err) {
    logger.error('[Monitor] Erro ao listar diretório de logs:', err);
    res.status(500).json({ error: 'Erro ao ler diretório de logs.' });
  }
});

app.get('/api/download/:filename', checkLogToken, (req, res) => {
  const { filename } = req.params;
  
  const safePath = path.join(LOG_DIR, path.basename(filename));
  if (!safePath.includes(LOG_DIR)) { 
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'monitor.html'));
});
app.get('/status', (req, res) => {
  res.json(statusManager.getStatus());
});


// --- 5. Inicialização e Agendamento de Jobs (Genérico) ---
io.on('connection', (socket) => {
  logger.info(`[Monitor] Novo cliente conectado: ${socket.id}`);
  socket.emit('status-update', statusManager.getStatus());
});

httpServer.listen(appConfig.monitorPort, async () => {
  logger.info(`[Serviço] Hub de Integração iniciado.`);
  logger.info(`[Monitor] Painel de monitoramento rodando em http://localhost:${appConfig.monitorPort}`);
  
  const blueprints = await loadBlueprints();
  
  if (blueprints.length === 0) {
      logger.warn('Nenhum Blueprint de rastreador habilitado ou encontrado. O serviço está rodando, mas nenhum job está agendado.');
  }
  
  // Agendamento de jobs via Blueprint
  for (const blueprint of blueprints) {
      const { run, interval } = createGenericJob(blueprint, sankhyaConfig);
      createJobLoop(blueprint.name, run, interval);
  }
});