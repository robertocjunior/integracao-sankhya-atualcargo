import { createLogger } from '../utils/logger.js';
import { 
    getValue, 
    transformValue, 
    execDateParser, // CORREÇÃO: Importa o novo nome da função
    formatLocation 
} from '../utils/mapper.utils.js';

const logger = createLogger('GenericMapper');

export function mapToStandard(positions, mapperConfig, jobName) {
  const standardPositions = [];
  const { type, typeField, typeRules, identifier, insertValue, date, fields } = mapperConfig;
  
  for (const pos of positions) {
    const rawDate = getValue(pos, date.sourceField);
    const dateObj = execDateParser(rawDate, date.parser); // CORREÇÃO: Chama a função com o novo nome
    const rawIdentifier = getValue(pos, identifier);
    
    // 1. Validação essencial
    if (!rawIdentifier || !dateObj || !date.parser) {
      logger.warn(`[${jobName}Mapper] Registro ignorado (ID/Data/Parser inválido). ID: ${rawIdentifier}`);
      continue;
    }
    
    // 2. Determinação do Tipo (Isca ou Veículo)
    let recordType = type;
    if (recordType === 'dynamic' && typeField && typeRules) {
        const typeValue = String(getValue(pos, typeField) || '');
        if (typeValue.startsWith(Object.keys(typeRules.startsWith)[0])) { 
            recordType = typeRules.startsWith.ISCA;
        } else {
            recordType = typeRules.startsWith.default;
        }
    }
    
    // 3. Extração e Transformação de Campos
    const standardRecord = {
      type: recordType,
      identifier: String(rawIdentifier).replace('ISCA', ''), 
      insertValue: getValue(pos, insertValue),
      date: dateObj,
    };
    
    for (const [standardField, sourceConfig] of Object.entries(fields)) {
        if (standardField === 'location') {
            standardRecord.location = formatLocation(pos, sourceConfig.sourceFields, sourceConfig.template);
            continue;
        }
        
        let value = null;
        if (typeof sourceConfig === 'object' && sourceConfig !== null) {
             // Caso com transformRule ou sourceField específico
            value = getValue(pos, sourceConfig.sourceField);
            if (sourceConfig.transformRule) {
                value = transformValue(sourceConfig.transformRule, value);
            }
        } else {
            // Mapeamento direto (key: 'source_path')
            value = getValue(pos, sourceConfig);
        }
        
        standardRecord[standardField] = value;
    }

    if (standardRecord.lat === undefined || standardRecord.lon === undefined) {
        logger.warn(`[${jobName}Mapper] Registro ignorado (Latitude/Longitude ausente). ID: ${standardRecord.identifier}`);
        continue;
    }

    standardPositions.push(standardRecord);
  }
  
  logger.info(`[${jobName}Mapper] Mapeadas ${standardPositions.length} posições.`);
  return standardPositions;
}