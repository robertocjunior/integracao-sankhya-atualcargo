// src/utils/sankhya.locker.js
import logger, { createLogger } from './logger.js';

const lockerLogger = createLogger('SankhyaLocker');

/**
 * Mutex simples baseado em Promise para garantir que apenas um Job 
 * acesse o Sankhya por vez.
 */
class SankhyaLocker {
  constructor() {
    // A fila de tarefas. Inicia com uma Promise resolvida para estar "aberta".
    this.queue = Promise.resolve();
  }

  /**
   * Executa uma função (callback) de forma exclusiva, esperando
   * todas as chamadas anteriores terminarem.
   * @param {string} jobName - Nome do job que está tentando adquirir o lock
   * @param {Function} callback - A função a ser executada com exclusão mútua
   */
  async withLock(jobName, callback) {
    let release;
    
    // Cria uma nova Promise que será resolvida quando o lock for liberado.
    const acquired = new Promise(resolve => {
        release = resolve;
    });

    // Enfileira a nova tarefa, garantindo a execução sequencial.
    this.queue = this.queue
      .then(() => {
        lockerLogger.info(`[${jobName}] Lock adquirido. Processando...`);
        return callback();
      })
      .catch(error => {
        // Propaga o erro do callback original para o job, mas garante a liberação.
        lockerLogger.error(`[${jobName}] Erro durante a execução sob Lock: ${error.message}`);
        throw error; 
      })
      .finally(() => {
        // Libera a próxima Promise na fila e limpa o lock.
        lockerLogger.info(`[${jobName}] Lock liberado.`);
        release();
      });

    return acquired;
  }
}

// Exporta uma instância única (Singleton)
const sankhyaLocker = new SankhyaLocker();
export default sankhyaLocker;