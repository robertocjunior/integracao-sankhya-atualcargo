# 🚚 Hub de Integração Sankhya-Rastreadores

Serviço modular em **Node.js** e **PM2** para integrar dados de posicionamento de diversas APIs de rastreadores (Atualcargo, Sitrax, etc.) diretamente no ERP Sankhya.

A arquitetura utiliza o conceito de ***Blueprints*** (arquivos de configuração `.yaml`), permitindo que a adição de novos rastreadores seja feita de forma declarativa, sem a necessidade de escrever novo código JavaScript para cada integração.

## Sumário

- Arquitetura e Fluxo de Trabalho
- Instalação e Configuração
- Execução e Monitoramento
- Como Criar um Novo Blueprint
- Exemplo de Blueprint Completo
- Troubleshooting

## 🎯 Arquitetura e Fluxo de Trabalho (ETL-as-a-Blueprint)

O sistema opera em um ciclo **ETL (Extract, Transform, Load)** contínuo, orquestrado pela leitura dos *Blueprints*:

1.  **Orquestração (`index.js`)**: O serviço principal carrega todos os arquivos `.yaml` da pasta `blueprints/` e inicia um processo de job genérico para cada um, de acordo com o intervalo definido.

2.  **Extract (Conector Genérico)**: O motor de conexão lê as configurações de URL, autenticação e cabeçalhos do *Blueprint* e realiza a chamada à API externa do rastreador.

3.  **Transform (Mapper Genérico)**: O motor de mapeamento lê as regras de transformação definidas no *Blueprint* (ex: onde encontrar a latitude, como formatar a data) e converte os dados brutos para um **Modelo de Dados Padrão (SDM)** interno.

4.  **Load (Processador Sankhya)**: O processador se autentica no Sankhya e insere os dados já padronizados nas tabelas de histórico (`AD_LOCATCAR` e `AD_LOCATISC`).

## 🛠️ Instalação e Configuração

### 1. Pré-requisitos

- **Node.js**: versão 18 ou superior.
- **PM2**: instalado globalmente (`npm install -g pm2`).

### 2. Arquivo de Ambiente (`.env`)

Crie um arquivo `.env` na raiz do projeto para gerenciar credenciais e configurações sensíveis.

| Variável | Descrição | Exemplo |
| :--- | :--- | :--- |
| `SANKHYA_URL` | URL base da API do Sankhya. | `http://sankhya.empresa.com.br` |
| `SANKHYA_USER` | Usuário para autenticação no Sankhya. | `sankhya_user` |
| `SANKHYA_PASSWORD` | Senha para autenticação no Sankhya. | `sankhya_pass` |
| `REQUEST_TIMEOUT_MS` | Timeout global para requisições HTTP. | `120000` (2 minutos) |
| `JOB_RETRY_DELAY_MS` | Tempo de espera (em ms) antes de retentar um job com falha. | `300000` (5 minutos) |
| `ATUALCARGO_URL` | URL da API do rastreador (exemplo). | `https://api.atualcargo.com.br` |
| `SITRAX_LOGIN` | Credencial da API do rastreador (exemplo). | `login_sitrax` |

> **Nota:** As credenciais de cada API de rastreador (`ATUALCARGO_URL`, `SITRAX_LOGIN`, etc.) são carregadas aqui e referenciadas nos *Blueprints* usando a sintaxe `${VAR_NAME}`.

### 3. Instalar Dependências

```bash
npm install
```

## 🚀 Execução e Monitoramento

O serviço é gerenciado pelo PM2, com os seguintes comandos:

| Comando | Descrição |
| :--- | :--- |
| `npm start` | Inicia ou reinicia o serviço `integracao-hub` em modo cluster. |
| `npm run stop` | Para o serviço `integracao-hub`. |
| `npm run logs` | Exibe os logs em tempo real do processo. |
| `pm2 delete integracao-hub` | Remove o processo da lista do PM2 (útil para limpar logs e caches). |

### Painel de Monitoramento

Para monitorar o status dos jobs (`idle`, `running`, `error`), o consumo de recursos e o tempo para a próxima execução, acesse o painel web do PM2:

**http://localhost:9222**

## 📝 Como Criar um Novo Blueprint

Para adicionar um novo rastreador, crie um arquivo `.yaml` na pasta `blueprints/` (ex: `rastreador_novo.yaml`). O serviço o detectará e iniciará automaticamente.

### Estrutura Base do Blueprint

| Seção | Obrigatório | Descrição |
| :--- | :--- | :--- |
| `name` | Sim | Nome amigável do Job (ex: "Rastreador Novo"). |
| `enabled` | Sim | `true` ou `false`. Ativa ou desativa a execução deste job. |
| `jobConfig` | Sim | Contém `intervalMinutes` (intervalo de execução) e `fabricanteId` (ID no Sankhya). |
| `connector` | Sim | Define como **extrair** os dados da API externa (fase *Extract*). |
| `mapper` | Sim | Define como **transformar** os dados para o padrão do Sankhya (fase *Transform*). |

---

### Detalhes da Seção `connector` (Extract)

Configura a conexão com a API do rastreador.

| Campo | Tipo | Descrição | Exemplo |
| :--- | :--- | :--- | :--- |
| `type` | String | Estratégia de conexão. Ex: `ATUALCARGO` (requer login/token), `SITRAX` (requer body customizado). | `ATUALCARGO` |
| `baseUrl` | ENV | URL base da API, lida do `.env`. | `${ATUALCARGO_URL}` |
| `positionsUrl` | String | Endpoint para buscar as posições. | `/api/v1/positions` |
| `positionsPath` | String | Caminho (usando dot notation) no JSON de resposta onde o array de posições se encontra. | `response.data.positions` |
| `omitContentTypeHeader` | Boolean | Defina como `true` para requisições `GET` que falham com o header `Content-Type` (ex: API Atualcargo). O padrão é `false`. | `true` |
| `auth` | Object | Contém as credenciais, que devem referenciar variáveis do `.env`. | `username: ${API_USER}` |

---

### Detalhes da Seção `mapper` (Transform)

Define como converter os dados da API para o **Modelo de Dados Padrão (SDM)** esperado pelo Sankhya.

#### Mapeamento de Identificação

| Campo | Descrição | Exemplo |
| :--- | :--- | :--- |
| `type` | Define se o item é `isca`, `vehicle` ou `dynamic` (usa `typeRules` para decidir). | `dynamic` |
| `typeField` | Campo do JSON de origem usado para aplicar as `typeRules`. | `plate` |
| `typeRules` | Regras para definir o tipo dinamicamente. | `startsWith: { "ISCA": "isca", "default": "vehicle" }` |
| `identifier` | Caminho (dot notation) para o campo que identifica o veículo/isca (ex: Placa, ID). | `plate` |
| `insertValue` | Caminho para o valor que será inserido no campo PLACA/NUMISCA do Sankhya. | `plate` |

#### Mapeamento de Data e Hora

| Campo | Descrição | Exemplo |
| :--- | :--- | :--- |
| `date.sourceField` | Caminho para o campo de data/hora no JSON de origem. | `date` |
| `date.parser` | Nome da função de parsing de data a ser usada (ex: `parseAtualcargoDate`). | `parseSitraxDate` |

#### Mapeamento de Campos (`fields`)

Mapeia os campos do SDM para os campos da API de origem, com possibilidade de transformações.

| Campo SDM | Configuração | Descrição |
| :--- | :--- | :--- |
| `lat` | `gps.latitude` | **Mapeamento direto**: O valor de `gps.latitude` do JSON de origem vai para o campo `lat` do SDM. |
| `ignition` | `{ "sourceField": "ign", "transformRule": "ON_to_S_OFF_to_N" }` | **Transformação**: Aplica uma regra que converte "ON" para "S" e "OFF" para "N". |
| `location` | `{ "sourceFields": ["city", "street"], "template": "${0}, ${1}" }` | **Template**: Concatena múltiplos campos. `${0}` é o primeiro item de `sourceFields`, `${1}` é o segundo, e assim por diante. |

## 📄 Exemplo de Blueprint Completo

Este é um exemplo de um arquivo `atualcargo.yaml` que pode ser usado como referência.

```yaml
# blueprints/atualcargo.yaml

name: "Integração Atualcargo"
enabled: true

jobConfig:
  intervalMinutes: 5
  fabricanteId: 1 # ID do fabricante no Sankhya

connector:
  type: "ATUALCARGO"
  baseUrl: ${ATUALCARGO_URL}
  # Credenciais para obter o token de autenticação
  auth:
    username: ${ATUALCARGO_USER}
    password: ${ATUALCARGO_PASSWORD}
    loginUrl: "/api/auth/login"
  
  # Endpoint para buscar os dados após autenticar
  positionsUrl: "/api/v1/vehicles/last-position"
  positionsPath: "data" # Caminho onde o array de posições está no JSON
  omitContentTypeHeader: true # Necessário para a API da Atualcargo

mapper:
  # Define o tipo (isca ou veículo) dinamicamente
  type: dynamic
  typeField: plate # Campo a ser analisado
  typeRules:
    startsWith:
      "ISCA": isca # Se o campo 'plate' começar com "ISCA", o tipo é 'isca'
      default: vehicle # Caso contrário, o tipo é 'vehicle'

  identifier: plate # Campo usado como identificador único (Placa)
  insertValue: plate # Valor a ser inserido no Sankhya

  # Configuração de data
  date:
    sourceField: date # Campo de origem da data
    parser: parseAtualcargoDate # Função para converter a string de data

  # Mapeamento de campos do rastreador para o padrão do sistema
  fields:
    lat: latlong.latitude # Mapeamento direto
    lon: latlong.longitude # Mapeamento direto
    speed: speed # Mapeamento direto
    
    # Exemplo de transformação de valor
    ignition:
      sourceField: ignition
      transformRule: ON_to_S_OFF_to_N # Converte 'ON' -> 'S', 'OFF' -> 'N'

    # Exemplo de concatenação de campos
    location:
      sourceFields: [proximity, address.street]
      template: "${0} | ${1} | Localização não informada"
```

## 🚨 Troubleshooting

- **Job com status `error`**: Verifique os logs com `npm run logs` para identificar a causa. Erros comuns incluem credenciais inválidas no `.env`, URL da API incorreta ou mudanças na estrutura do JSON de resposta do rastreador.
- **Blueprint não é carregado**: Certifique-se de que o arquivo `.yaml` está na pasta `blueprints/`, não possui erros de sintaxe YAML e a propriedade `enabled` está como `true`.
- **Dados não chegam no Sankhya**: Verifique se o `mapper` está configurado corretamente, especialmente os campos `identifier` e `insertValue`, e se as credenciais do Sankhya no `.env` estão corretas.