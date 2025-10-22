// ARQUIVO COMPLETO: src/services/vector.service.js

import * as lancedb from 'vectordb';
import { log, error as logError } from '../utils/logger.service.js';
import path from 'path';

// O LanceDB armazenará seus dados em um diretório na raiz do projeto.
const LANCEDB_DIR = path.join(process.cwd(), 'lancedb');
const CRITERIA_TABLE_NAME = 'criteria_vectors';
const VECTOR_DIMENSION = 1536; // Dimensão do modelo 'text-embedding-3-small' da OpenAI

let db;
let criteriaTable;

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
        if (tableNames.includes(CRITERIA_TABLE_NAME)) {
            criteriaTable = await db.openTable(CRITERIA_TABLE_NAME);
            log(`✅ Tabela de critérios '${CRITERIA_TABLE_NAME}' aberta com sucesso.`);
        } else {
            // Cria a tabela com um schema inicial
            criteriaTable = await db.createTable(CRITERIA_TABLE_NAME, [
                { vector: Array(VECTOR_DIMENSION).fill(0), uuid: 'dummy' }
            ]);
            log(`✅ Tabela de critérios '${CRITERIA_TABLE_NAME}' criada com sucesso.`);
        }
    } catch (err) {
        logError('Falha crítica ao inicializar o LanceDB:', err.message);
        process.exit(1);
    }
};

/**
 * Adiciona ou atualiza um vetor na tabela de critérios do LanceDB.
 * Usa o UUID do critério como identificador.
 * @param {string} uuid - O UUID do critério do PostgreSQL.
 * @param {number[]} vector - O vetor de embedding gerado pela OpenAI.
 */
export const addOrUpdateVector = async (uuid, vector) => {
    if (!criteriaTable) throw new Error('A tabela de critérios do LanceDB não está inicializada.');
    if (!uuid || !vector) {
        logError('Tentativa de adicionar vetor de critério com UUID ou vetor nulo.');
        return;
    }
    try {
        // A estratégia de "upsert" mais simples é deletar o registro antigo (se existir) e adicionar o novo.
        await criteriaTable.delete(`uuid = '${uuid}'`); 
        await criteriaTable.add([{ uuid, vector }]);
        log(`Vetor para o critério UUID ${uuid} foi adicionado/atualizado no LanceDB.`);
    } catch (err) {
        // O erro de deleção em um registro inexistente é esperado, então podemos ignorá-lo
        if (!err.message.includes('No rows matched filter')) {
           logError(`Erro ao adicionar/atualizar vetor de critério para UUID ${uuid}:`, err.message);
        } else {
           // Se o erro for "não encontrado para deletar", prosseguimos com a adição
           await criteriaTable.add([{ uuid, vector }]);
           log(`Vetor para o critério UUID ${uuid} foi adicionado (sem atualização prévia) no LanceDB.`);
        }
    }
};

/**
 * Remove um vetor da tabela de critérios do LanceDB usando o UUID do critério.
 * @param {string} uuid - O UUID do critério a ser removido.
 */
export const deleteVector = async (uuid) => {
    if (!criteriaTable) throw new Error('A tabela de critérios do LanceDB não está inicializada.');
    try {
        await criteriaTable.delete(`uuid = '${uuid}'`);
    } catch (err) {
        // Ignora o erro se o registro não for encontrado, pois o resultado desejado (ausência do registro) é o mesmo.
        if (!err.message.includes('No rows matched filter')) {
           logError(`Erro ao deletar vetor de critério para UUID ${uuid}:`, err.message);
        }
    }
};

/**
 * Busca os vetores de critérios mais similares a um vetor de consulta.
 * @param {number[]} queryVector - O vetor a ser usado na busca.
 * @param {number} limit - O número de resultados a serem retornados.
 * @returns {Promise<object[]>} Uma lista de resultados da busca (inclui UUIDs dos critérios).
 */
export const searchSimilarVectors = async (queryVector, limit = 5) => {
    if (!criteriaTable) throw new Error('A tabela de critérios do LanceDB não está inicializada.');
    try {
        const results = await criteriaTable
            .search(queryVector)
            .limit(limit)
            .execute();
        
        return results;
    } catch (err) {
        logError('Erro ao realizar busca vetorial na tabela de critérios:', err.message);
        return [];
    }
};


// --- NOVAS FUNÇÕES PARA TABELAS TEMPORÁRIAS DE PERFIL ---

/**
 * Cria uma nova tabela temporária para os vetores de um perfil.
 * @param {string} tableName - O nome único da tabela.
 * @param {Array<object>} data - Os dados a serem inseridos (ex: [{ vector, text }]).
 * @returns {Promise<lancedb.Table>} A instância da tabela criada.
 */
export const createProfileVectorTable = async (tableName, data) => {
    if (!db) throw new Error('LanceDB não está inicializado.');
    try {
        // O LanceDB infere o schema a partir do primeiro objeto de dados.
        const table = await db.createTable(tableName, data);
        log(`✅ Tabela temporária '${tableName}' criada com ${data.length} vetores de perfil.`);
        return table;
    } catch (err) {
        logError(`Erro ao criar tabela temporária '${tableName}':`, err.message);
        throw err; // Re-lança o erro para ser tratado pelo 'match.service'
    }
};

/**
 * Deleta uma tabela temporária.
 * @param {string} tableName - O nome da tabela a ser deletada.
 */
export const dropProfileVectorTable = async (tableName) => {
    if (!db) throw new Error('LanceDB não está inicializado.');
    try {
        await db.dropTable(tableName);
        log(`🗑️ Tabela temporária '${tableName}' removida com sucesso.`);
    } catch (err) {
        logError(`Erro ao remover tabela temporária '${tableName}':`, err.message);
        // Não re-lançamos o erro aqui, pois a falha na limpeza não deve quebrar a requisição principal.
    }
};