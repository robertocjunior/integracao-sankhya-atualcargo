import { startApp } from './src/app.js';
import logger from './src/utils/logger.js';

// Capturador global de erros não tratados
process.on('uncaughtException', (error) => {
  logger.error('Erro não capturado (uncaughtException):', error);
  process.exit(1); // Encerra o processo em caso de erro fatal
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Rejeição de Promise não tratada (unhandledRejection):', reason);
});

// Inicia a aplicação
startApp();