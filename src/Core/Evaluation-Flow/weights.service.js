// CRIE O ARQUIVO: src/Core/Evaluation-Flow/weights.service.js

import Database from 'better-sqlite3';
import path from 'path';
import { log, error } from '../../utils/logger.service.js';

// Conecta-se ao mesmo banco de dados do cache
const dbPath = path.join(process.cwd(), 'linkedin_cache.sqlite');
const db = new Database(dbPath);

/**
 * Busca os pesos de todos os critérios para um kit de entrevista específico.
 * @param {string} kitId - O ID do kit de entrevista.
 * @returns {Promise<object>} Um objeto no formato { skill_id: weight, ... }.
 */
export const getWeightsForKit = async (kitId) => {
    try {
        const stmt = db.prepare('SELECT skill_id, weight FROM interview_kit_weights WHERE kit_id = ?');
        const rows = stmt.all(kitId);

        // Transforma o array de resultados em um objeto mais fácil de usar no frontend
        const weightsMap = rows.reduce((acc, row) => {
            acc[row.skill_id] = row.weight;
            return acc;
        }, {});

        return weightsMap;
    } catch (err) {
        error(`Erro ao buscar pesos para o kit ${kitId} no SQLite:`, err.message);
        return {}; // Retorna um objeto vazio em caso de erro
    }
};

/**
 * Salva ou atualiza os pesos para múltiplos critérios de um kit de entrevista.
 * Usa uma transação para garantir a atomicidade e performance.
 * @param {string} kitId - O ID do kit de entrevista.
 * @param {object} weightsData - Objeto com os pesos, ex: { 'skill_id_1': 2, 'skill_id_2': 3 }.
 * @returns {Promise<boolean>} True se for bem-sucedido, false caso contrário.
 */
export const saveWeightsForKit = async (kitId, weightsData) => {
    try {
        // Prepara a query de UPSERT (INSERT OR REPLACE)
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO interview_kit_weights (kit_id, skill_id, weight) 
            VALUES (?, ?, ?)
        `);

        // Cria uma transação para executar todas as inserções de uma vez
        const saveTransaction = db.transaction((items) => {
            for (const item of items) {
                stmt.run(item.kit_id, item.skill_id, item.weight);
            }
            return items.length;
        });

        const itemsToSave = Object.entries(weightsData).map(([skillId, weight]) => ({
            kit_id: kitId,
            skill_id: skillId,
            weight: weight
        }));

        const changes = saveTransaction(itemsToSave);
        log(`Pesos para o kit ${kitId} salvos/atualizados com sucesso. ${changes} registros afetados.`);
        return true;
    } catch (err) {
        error(`Erro ao salvar pesos para o kit ${kitId} no SQLite:`, err.message);
        return false;
    }
};