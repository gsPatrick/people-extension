# --- Estágio 1: Build ---
FROM mirror.gcr.io/library/node:20-slim AS build

# Diretório de trabalho
WORKDIR /app

# Instala dependências do sistema
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        build-essential \
        g++ \
        make \
        libsqlite3-dev \
        sqlite3 \
        poppler-utils \
        curl && \
    rm -rf /var/lib/apt/lists/*

# Copia package.json
COPY package*.json ./

# Instala dependências
RUN npm install --omit=dev --build-from-source

# Baixa a extensão VSS pré-compilada
RUN mkdir -p /app/extensions && \
    curl -L https://github.com/asg017/sqlite-vss/releases/download/v0.1.2/vss0-linux-x86_64.so \
    -o /app/extensions/vss0.so && \
    chmod +x /app/extensions/vss0.so && \
    echo "✅ Extensão VSS baixada com sucesso"

# Copia código
COPY . .

# --- Estágio 2: Runtime ---
FROM mirror.gcr.io/library/node:20-slim AS runtime
WORKDIR /app

# Instala dependências de runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libsqlite3-0 \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copia app + node_modules do build stage
COPY --from=build /app ./

# Expõe a porta
EXPOSE 80

# Define ambiente de produção
ENV NODE_ENV=production
ENV VSS_EXTENSION_PATH=/app/extensions/vss0.so

# Comando padrão
CMD ["node", "server.js"]