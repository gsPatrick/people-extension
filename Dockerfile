# --- Estágio 1: Build ---
# Usamos Node 20 via mirror.gcr.io para evitar limite do Docker Hub
FROM mirror.gcr.io/library/node:20-slim AS build

# Diretório de trabalho
WORKDIR /app

# Instala dependências do sistema necessárias para compilação
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        build-essential \
        g++ \
        make \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copia arquivos de dependências para cache de Docker
COPY package*.json ./

# Instala as dependências de produção (omit dev)
RUN npm install --omit=dev

# Copia todo o código da aplicação
COPY . .

# --- Estágio 2: Runtime ---
# Usamos Node 20 slim para runtime também
FROM mirror.gcr.io/library/node:20-slim AS runtime
WORKDIR /app

# Copia apenas o que é necessário do build
COPY --from=build /app ./

# Expõe a porta que sua aplicação usa
EXPOSE 80

# Define ambiente de produção
ENV NODE_ENV=production

# Comando padrão
CMD ["node", "server.js"]
