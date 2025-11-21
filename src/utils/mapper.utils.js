import pkg from 'lodash';
import { parseAtualcargoDate, parseSitraxDate, parseISODate } from './dateTime.js'; // Inclui parseISODate

const { get } = pkg; // Importação correta para ES Modules

const dateParsers = {
  parseAtualcargoDate: parseAtualcargoDate,
  parseSitraxDate: parseSitraxDate,
  parseISODate: parseISODate, // Registra o novo parser ISO
};

const transformRules = {
  ON_to_S_OFF_to_N: (value) => (value === 'ON' ? 'S' : 'N'),
  S_to_S_N_to_N: (value) => (value === 'S' ? 'S' : 'N'),
  // NOVO: Regra para converter booleano para S/N (true/false)
  Boolean_to_S_N: (value) => (value === true || String(value).toLowerCase() === 'true' ? 'S' : 'N'), 
};

export function getValue(data, path) {
  return get(data, path);
}

export function transformValue(ruleName, value) {
  const rule = transformRules[ruleName];
  if (rule) {
    return rule(value);
  }
  return value;
}

export function parseDate(dateString, parserName) {
    const parser = dateParsers[parserName];
    if (!parser) {
        return null;
    }
    return parser(dateString);
}

export function formatLocation(data, paths, template) {
    const values = paths.map(path => getValue(data, path)).filter(v => v !== null && v !== undefined);
    
    let result = template;
    for (let i = 0; i < values.length; i++) {
        const valueStr = String(values[i] || '').trim();
        const placeholder = new RegExp(`\\$\\{${i}\\}`, 'g');
        result = result.replace(placeholder, valueStr);
    }
    
    result = result
      .replace(/,(\s*),/g, ',') 
      .replace(/ \| ,/g, ' | ') 
      .replace(/\s*-\s*|,\s*$/, '') 
      .trim();

    if (result.includes('Localização não informada')) {
      const parts = result.split('|').map(s => s.trim()).filter(s => s && s !== 'Localização não informada');
      if (parts.length > 0) {
        return parts[0]; 
      }
      return 'Localização não informada';
    }
    
    return result;
}