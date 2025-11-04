import { createLogger, format, transports } from 'winston';
import path from 'path';

const { combine, timestamp, printf, colorize, json } = format;

// Formato para o console
const consoleFormat = combine(
  colorize(),
  timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  printf(({ level, message, timestamp }) => {
    return `[${timestamp}] ${level}: ${message}`;
  })
);

// Formato para os arquivos
const fileFormat = combine(
  timestamp(),
  json()
);

const logger = createLogger({
  level: 'info', // Nível mínimo de log
  format: fileFormat,
  transports: [
    // Salva erros no arquivo /logs/error.log
    new transports.File({ 
      filename: path.join(process.cwd(), 'logs', 'error.log'), 
      level: 'error' 
    }),
    // Salva todos os logs no arquivo /logs/app.log
    new transports.File({ 
      filename: path.join(process.cwd(), 'logs', 'app.log') 
    }),
  ],
});

// Se não estivermos em produção, também logar no console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: consoleFormat,
  }));
}

export default logger;