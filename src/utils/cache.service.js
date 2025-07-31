import { log } from './logger.service.js';

/**
 * Serviço de cache em memória simples com Time-To-Live (TTL).
 */

const cache = new Map();
const TTL = 5 * 60 * 1000; // 5 minutos em milissegundos

/**
 * Obtém um valor do cache. Retorna null se a chave não existir ou tiver expirado.
 * @param {string} key - A chave do cache.
 * @returns {any | null}
 */
export const getFromCache = (key) => {
  const cachedItem = cache.get(key);

  if (!cachedItem) {
    log(`CACHE MISS: Chave "${key}" não encontrada.`);
    return null;
  }

  const isExpired = (Date.now() - cachedItem.timestamp) > TTL;

  if (isExpired) {
    log(`CACHE EXPIRED: Chave "${key}" expirou. Removendo.`);
    cache.delete(key);
    return null;
  }

  log(`CACHE HIT: Retornando dados para a chave "${key}".`);
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
    timestamp: Date.now(),
  };
  cache.set(key, item);
  log(`CACHE SET: Dados armazenados para a chave "${key}" com TTL de ${TTL / 1000}s.`);
};

/**
 * Limpa chaves do cache que começam com um prefixo específico.
 * Essencial para invalidar listas quando um item é criado/alterado.
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