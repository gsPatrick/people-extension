# --- Estágio 1: Build ---
FROM mirror.gcr.io/library/node:20-slim AS build

# Diretório de trabalho
WORKDIR /app

# Instala dependências do sistema necessárias para compilação de nativos
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        build-essential \
        g++ \
        make \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copia apenas package.json e package-lock.json para cache de Docker
COPY package*.json ./

# Instala dependências dentro do container
RUN npm install --omit=dev

# Copia todo o resto do código
COPY . .

# --- Estágio 2: Runtime ---
FROM mirror.gcr.io/library/node:20-slim AS runtime
WORKDIR /app

# Copia app + node_modules do build stage
COPY --from=build /app ./

# Expõe a porta
EXPOSE 80

# Define ambiente de produção
ENV NODE_ENV=production

# Comando padrão
CMD ["node", "server.js"]
