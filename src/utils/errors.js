/**
 * Erro genérico de autenticação ou token
 */
export class TokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TokenError';
  }
}

/**
 * Erro específico para a API Atualcargo
 */
export class AtualcargoTokenError extends TokenError {
  constructor(message) {
    super(message);
    this.name = 'AtualcargoTokenError';
  }
}

/**
 * Erro específico para a API Sankhya
 */
export class SankhyaTokenError extends TokenError {
  constructor(message) {
    super(message);
    this.name = 'SankhyaTokenError';
  }
}

/**
 * Erro específico para a API Positron
 */
export class PositronTokenError extends TokenError {
  constructor(message) {
    super(message);
    this.name = 'PositronTokenError';
  }
}