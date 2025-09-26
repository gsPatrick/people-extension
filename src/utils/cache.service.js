import { log } from './logger.service.js';

/**
 * Serviço de cache em memória simples.
 */

const cache = new Map();
// REMOVIDO: const TTL = 5 * 60 * 1000;

/**
 * Obtém um valor do cache.
 * @param {string} key - A chave do cache.
 * @returns {any | null}
 */
export const getFromCache = (key) => {
  const cachedItem = cache.get(key);

  if (!cachedItem) {
    log(`CACHE MISS: Chave "${key}" não encontrada.`);
    return null;
  }

  // REMOVIDA A LÓGICA DE EXPIRAÇÃO
  // const isExpired = (Date.now() - cachedItem.timestamp) > TTL;
  // if (isExpired) { ... }

  log(`CACHE HIT: Retornando dados para a chave "${key}".`);
  // Retorna diretamente os dados, sem o timestamp
  return cachedItem.data;
};

/**
 * Adiciona um valor ao cache.
 * @param {string} key - A chave do cache.
 * @param {any} data - O dado a ser armazenado.
 */
export const setToCache = (key, data) => {
  const item = {
    data: data,
    timestamp: Date.now(), // Mantemos o timestamp para referência, se necessário
  };
  cache.set(key, item);
  log(`CACHE SET: Dados armazenados para a chave "${key}".`);
};

/**
 * Limpa chaves do cache que começam com um prefixo específico.
 * @param {string} prefix - O prefixo para limpar (ex: 'talents_page_').
 */
export const clearCacheByPrefix = (prefix) => {
    log(`CACHE CLEAR: Limpando chaves que começam com "${prefix}"...`);
    let count = 0;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) {
            cache.delete(key);
            count++;
        }
    }
    log(`CACHE CLEAR: ${count} chave(s) removida(s).`);
};