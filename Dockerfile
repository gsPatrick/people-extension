FROM mirror.gcr.io/library/node:20-slim AS build

WORKDIR /app

# Dependências do sistema
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        python3 \
        python3-pip \
        build-essential \
        g++ \
        make \
        poppler-utils && \
    rm -rf /var/lib/apt/lists/*

# Copia somente package.json / package-lock.json
COPY package*.json ./

# Instala as dependências dentro do container
RUN npm install --omit=dev

# Copia o restante do código
COPY . .

# Runtime stage
FROM mirror.gcr.io/library/node:20-slim AS runtime
WORKDIR /app

# Copia app + node_modules do build stage
COPY --from=build /app ./

EXPOSE 80
ENV NODE_ENV=production
CMD ["node", "server.js"]
