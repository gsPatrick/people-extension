// CRIE O ARQUIVO: src/services/vector.service.js

import * as lancedb from 'vectordb';
import { log, error as logError } from '../utils/logger.service.js';
import path from 'path';

// O LanceDB armazenará seus dados em um diretório na raiz do projeto.
const LANCEDB_DIR = path.join(process.cwd(), 'lancedb');
const TABLE_NAME = 'criteria_vectors';
const VECTOR_DIMENSION = 1536; // Dimensão do modelo 'text-embedding-3-small' da OpenAI

let db;
let table;

/**
 * Inicializa a conexão com o LanceDB e cria a tabela de vetores se não existir.
 * Deve ser chamado uma vez na inicialização do servidor.
 */
export const initializeVectorDB = async () => {
    try {
        log('--- INICIALIZAÇÃO DO LANCEDB ---');
        db = await lancedb.connect(LANCEDB_DIR);
        log(`✅ Conectado ao LanceDB no diretório: ${LANCEDB_DIR}`);

        const tableNames = await db.tableNames();
        if (tableNames.includes(TABLE_NAME)) {
            table = await db.openTable(TABLE_NAME);
            log(`✅ Tabela de vetores '${TABLE_NAME}' aberta com sucesso.`);
        } else {
            table = await db.createTable(TABLE_NAME, [
                { vector: Array(VECTOR_DIMENSION).fill(0), uuid: 'dummy' }
            ]);
            log(`✅ Tabela de vetores '${TABLE_NAME}' criada com sucesso.`);
        }
    } catch (err) {
        logError('Falha crítica ao inicializar o LanceDB:', err.message);
        process.exit(1);
    }
};

/**
 * Adiciona ou atualiza um vetor na tabela do LanceDB.
 * Usa o UUID do critério como identificador.
 * @param {string} uuid - O UUID do critério do PostgreSQL.
 * @param {number[]} vector - O vetor de embedding gerado pela OpenAI.
 */
export const addOrUpdateVector = async (uuid, vector) => {
    if (!table) throw new Error('A tabela do LanceDB não está inicializada.');
    if (!uuid || !vector) {
        logError('Tentativa de adicionar vetor com UUID ou vetor nulo.');
        return;
    }
    try {
        // A estratégia de "upsert" mais simples é deletar e adicionar.
        await deleteVector(uuid); 
        await table.add([{ uuid, vector }]);
        log(`Vetor para o critério UUID ${uuid} foi adicionado/atualizado no LanceDB.`);
    } catch (err) {
        logError(`Erro ao adicionar/atualizar vetor para UUID ${uuid}:`, err.message);
    }
};

/**
 * Remove um vetor do LanceDB usando o UUID do critério.
 * @param {string} uuid - O UUID do critério a ser removido.
 */
export const deleteVector = async (uuid) => {
    if (!table) throw new Error('A tabela do LanceDB não está inicializada.');
    try {
        // A cláusula WHERE permite deletar registros específicos.
        await table.delete(`uuid = '${uuid}'`);
    } catch (err) {
        // Ignora o erro se o registro não for encontrado, pois o resultado desejado é o mesmo.
        if (!err.message.includes('No rows matched filter')) {
           logError(`Erro ao deletar vetor para UUID ${uuid}:`, err.message);
        }
    }
};

/**
 * Busca os vetores mais similares a um vetor de consulta.
 * @param {number[]} queryVector - O vetor a ser usado na busca.
 * @param {number} limit - O número de resultados a serem retornados.
 * @returns {Promise<object[]>} Uma lista de resultados da busca.
 */
export const searchSimilarVectors = async (queryVector, limit = 5) => {
    if (!table) throw new Error('A tabela do LanceDB não está inicializada.');
    try {
        const results = await table
            .search(queryVector)
            .limit(limit)
            .execute();
        
        return results;
    } catch (err) {
        logError('Erro ao realizar busca vetorial no LanceDB:', err.message);
        return [];
    }
};