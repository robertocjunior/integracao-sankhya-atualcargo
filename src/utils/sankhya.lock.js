import logger from './logger.js';

let lockPromise = Promise.resolve(); // Inicia 'desbloqueado'

/**
 * Executa uma função de trabalho de forma serializada.
 * Garante que apenas uma função por vez acesse a API Sankhya.
 * @param {Function} workerFunction - A função assíncrona que acessa o Sankhya.
 */
export async function executeInSankhyaLock(workerFunction) {
  // Cria uma nova Promise que será resolvida quando o trabalho atual terminar
  const newLock = new Promise((resolve, reject) => {
    // Quando o lock anterior (lockPromise) for resolvido:
    lockPromise.then(async () => {
      try {
        // 1. Executa o trabalho
        const result = await workerFunction();
        // 2. Resolve a Promise do novo lock
        resolve(result); 
      } catch (error) {
        // Em caso de erro, rejeita a Promise do novo lock
        reject(error);
      }
    });
  });

  // Atualiza o lockPromise para a nova Promise
  // Isso garante que o próximo trabalho esperará por este.
  lockPromise = newLock.catch(() => {}); // Captura a rejeição para não quebrar a cadeia
  
  return newLock; // Retorna a Promise que resolve com o resultado do trabalho
}