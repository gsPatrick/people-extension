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
        libsqlite3-dev \
        sqlite3 \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copia apenas package.json e package-lock.json para cache de Docker
COPY package*.json ./

# Instala dependências dentro do container e força compilação de extensões nativas
RUN npm install --omit=dev --build-from-source

# Rebuild especificamente sqlite-vss para garantir compilação
RUN npm rebuild sqlite-vss --build-from-source || echo "Aviso: sqlite-vss rebuild falhou"

# Verifica se a extensão VSS foi compilada
RUN if [ -f node_modules/sqlite-vss/build/Release/vss0.node ]; then \
        echo "✅ Extensão VSS compilada com sucesso em node_modules/sqlite-vss/build/Release/vss0.node"; \
    else \
        echo "❌ AVISO: Extensão VSS não foi compilada"; \
        find node_modules/sqlite-vss -name "*.node" 2>/dev/null || echo "Nenhum arquivo .node encontrado"; \
    fi

# Copia todo o resto do código
COPY . .

# --- Estágio 2: Runtime ---
FROM mirror.gcr.io/library/node:20-slim AS runtime
WORKDIR /app

# Instala apenas dependências de runtime necessárias para sqlite-vss
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

# Comando padrão
CMD ["node", "server.js"]