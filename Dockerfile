# ===============================
# --- ESTÁGIO 1: BUILD ---
# ===============================
FROM mirror.gcr.io/library/node:20-slim AS build

# Diretório de trabalho
WORKDIR /app

# Atualiza pacotes e instala dependências essenciais para build
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

# Copia manifestos de dependências
COPY package*.json ./

# Instala dependências (com build nativo)
RUN npm install --omit=dev --build-from-source

# 🔧 Recompila sqlite3 e sqlite-vss com suporte total a extensões externas
RUN npm rebuild sqlite3 --build-from-source --sqlite=/usr && \
    npm rebuild sqlite-vss --build-from-source

# 📦 Baixa a extensão VSS pré-compilada
RUN mkdir -p /app/extensions && \
    curl -L https://github.com/asg017/sqlite-vss/releases/download/v0.1.2/vss0-linux-x86_64.so \
    -o /app/extensions/vss0.so && \
    chmod 755 /app/extensions/vss0.so && \
    echo "✅ Extensão VSS baixada e configurada com sucesso."

# Copia o restante do código da aplicação
COPY . .

# ===============================
# --- ESTÁGIO 2: RUNTIME ---
# ===============================
FROM mirror.gcr.io/library/node:20-slim AS runtime

WORKDIR /app

# Instala apenas dependências necessárias para execução
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libsqlite3-0 \
        poppler-utils \
        curl && \
    rm -rf /var/lib/apt/lists/*

# Copia arquivos do estágio de build
COPY --from=build /app ./

# Expõe a porta da aplicação
EXPOSE 80

# Define variáveis de ambiente
ENV NODE_ENV=production
ENV VSS_EXTENSION_PATH=/app/extensions/vss0.so

# Comando padrão de inicialização
CMD ["node", "server.js"]
