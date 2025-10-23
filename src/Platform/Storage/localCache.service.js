// ARQUIVO COMPLETO E ATUALIZADO: src/Platform/Storage/localCache.service.js

import sqlite3 from 'sqlite3';
import { log, error } from '../../utils/logger.service.js';

const DB_PATH = './local_cache.sqlite';
let db;

/**
 * Inicializa a conexão com o banco de dados SQLite e cria as tabelas se não existirem.
 * Deve ser chamado uma vez na inicialização do servidor.
 */
export const initializeCache = () => {
    db = new sqlite3.Database(DB_PATH, (err) => {
        if (err) {
            error('CACHE_SQLITE: Erro ao conectar ao banco de dados', err.message);
        } else {
            log('✅ Conectado ao banco de dados de cache local (SQLite).');
            
            // Usa db.serialize para garantir que os comandos rodem em sequência
            db.serialize(() => {
                // Tabela 1: Para perfis brutos (a sua original)
                db.run(`CREATE TABLE IF NOT EXISTS raw_profiles (
                    linkedin_username TEXT PRIMARY KEY,
                    raw_data TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, (createErr) => {
                    if (createErr) {
                        error('CACHE_SQLITE: Erro ao criar a tabela raw_profiles', createErr.message);
                    } else {
                        log('Tabela `raw_profiles` verificada/criada.');
                    }
                });

                // Tabela 2: Para cache genérico de chave/valor (para embeddings, etc.)
                db.run(`CREATE TABLE IF NOT EXISTS generic_cache (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )`, (createErr) => {
                    if (createErr) {
                        error('CACHE_SQLITE: Erro ao criar a tabela generic_cache', createErr.message);
                    } else {
                        log('Tabela `generic_cache` verificada/criada.');
                    }
                });
            });
        }
    });
};

// --- FUNÇÕES ORIGINAIS (PARA A TABELA raw_profiles) ---

/**
 * Salva ou atualiza os dados brutos de um perfil no cache.
 * @param {string} linkedinUsername - O username do LinkedIn.
 * @param {object} rawData - O objeto JSON completo do scraping.
 */
export const saveRawProfile = (linkedinUsername, rawData) => {
    return new Promise((resolve, reject) => {
        if (!db || !linkedinUsername) return reject(new Error('CACHE_SQLITE: Cache não inicializado ou username inválido.'));
        
        const jsonData = JSON.stringify(rawData);
        const sql = `INSERT OR REPLACE INTO raw_profiles (linkedin_username, raw_data) VALUES (?, ?)`;
        
        db.run(sql, [linkedinUsername, jsonData], function(err) {
            if (err) {
                error(`CACHE_SQLITE: Erro ao salvar perfil ${linkedinUsername}`, err.message);
                return reject(err);
            }
            log(`💾 Perfil bruto de ${linkedinUsername} salvo/atualizado no cache local.`);
            resolve();
        });
    });
};

/**
 * Busca os dados brutos de um perfil do cache.
 * @param {string} linkedinUsername - O username do LinkedIn.
 * @returns {Promise<object|null>} O objeto do perfil parseado ou null.
 */
export const getRawProfile = (linkedinUsername) => {
    return new Promise((resolve, reject) => {
        if (!db || !linkedinUsername) return reject(new Error('CACHE_SQLITE: Cache não inicializado ou username inválido.'));

        const sql = `SELECT raw_data FROM raw_profiles WHERE linkedin_username = ?`;
        db.get(sql, [linkedinUsername], (err, row) => {
            if (err) {
                error(`CACHE_SQLITE: Erro ao buscar perfil ${linkedinUsername}`, err.message);
                return reject(err);
            }
            if (row) {
                log(`HIT: Perfil bruto de ${linkedinUsername} encontrado no cache local.`);
                resolve(JSON.parse(row.raw_data));
            } else {
                log(`MISS: Perfil bruto de ${linkedinUsername} NÃO encontrado no cache local.`);
                resolve(null);
            }
        });
    });
};

// --- NOVAS FUNÇÕES GENÉRICAS (PARA A TABELA generic_cache) ---

/**
 * Salva ou atualiza um valor genérico no cache.
 * @param {string} key - A chave única para o dado.
 * @param {any} value - O dado a ser armazenado (será convertido para JSON).
 */
export const setGenericCache = (key, value) => {
    return new Promise((resolve, reject) => {
        if (!db || !key) return reject(new Error('CACHE_SQLITE: Cache não inicializado ou chave inválida.'));
        
        const jsonData = JSON.stringify(value);
        const sql = `INSERT OR REPLACE INTO generic_cache (key, value) VALUES (?, ?)`;
        
        db.run(sql, [key, jsonData], function(err) {
            if (err) {
                error(`CACHE_SQLITE: Erro ao salvar a chave genérica ${key}`, err.message);
                return reject(err);
            }
            log(`💾 Chave genérica ${key} salva/atualizada no cache local.`);
            resolve();
        });
    });
};

/**
 * Busca um valor genérico do cache pela chave.
 * @param {string} key - A chave do dado a ser buscado.
 * @returns {Promise<any|null>} O dado parseado ou null se não encontrado.
 */
export const getGenericCache = (key) => {
    return new Promise((resolve, reject) => {
        if (!db || !key) return reject(new Error('CACHE_SQLITE: Cache não inicializado ou chave inválida.'));

        const sql = `SELECT value FROM generic_cache WHERE key = ?`;
        db.get(sql, [key], (err, row) => {
            if (err) {
                error(`CACHE_SQLITE: Erro ao buscar a chave genérica ${key}`, err.message);
                return reject(err);
            }
            if (row) {
                resolve(JSON.parse(row.value));
            } else {
                resolve(null);
            }
        });
    });
};