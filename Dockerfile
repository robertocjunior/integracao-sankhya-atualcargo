# 1. Imagem Base
# Usamos uma imagem oficial do Node.js leve e segura
FROM node:18-alpine

# 2. Define o diretório de trabalho dentro do container
WORKDIR /app

# 3. Copia os arquivos de dependência
COPY package.json ./
COPY package-lock.json ./ 

# Usamos 'npm ci' que é mais rápido e seguro para builds
RUN npm ci

# 4. Instala o PM2 globalmente dentro do container
# PM2 é o que garante o reinício automático em caso de falha no script
RUN npm install pm2 -g

# 5. Copia o restante do código-fonte do seu projeto
COPY . .

# 6. Comando para iniciar o serviço
# "pm2-runtime" é a versão do PM2 feita para rodar dentro de containers
CMD ["pm2-runtime", "index.js", "--name", "integracao-sankhya"]