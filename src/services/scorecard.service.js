// ARQUIVO COMPLETO E FINAL: src/services/scorecard.service.js

import db from '../models/index.js';
import { clearCacheByPrefix, getFromCache, setToCache } from '../utils/cache.service.js';
import { log, error as logError } from '../utils/logger.service.js';

const SCORECARDS_CACHE_PREFIX = 'scorecards_';
const ALL_SCORECARDS_CACHE_KEY = `${SCORECARDS_CACHE_PREFIX}all`;

/**
 * Função helper para ordenar categorias e critérios em memória.
 * @param {object} data - O objeto scorecard.
 */
const sortChildrenInMemory = (data) => {
    if (data && data.categories) {
        // Ordena as categorias pelo campo 'order'
        data.categories.sort((a, b) => a.order - b.order);
        
        // Para cada categoria, ordena seus critérios
        data.categories.forEach(category => {
            if (category.criteria) {
                category.criteria.sort((a, b) => a.order - b.order);
            } else {
                // Garante que 'criteria' seja sempre um array para evitar erros no frontend
                category.criteria = [];
            }
        });
    }
};

/**
 * Busca todos os scorecards com suas categorias e critérios aninhados.
 */
export const findAll = async () => {
  const cachedScorecards = getFromCache(ALL_SCORECARDS_CACHE_KEY);
  if (cachedScorecards) {
    log('CACHE HIT: Retornando todos os scorecards do cache.');
    return cachedScorecards;
  }

  try {
    const scorecards = await db.Scorecard.findAll({
      include: [{
        model: db.Category,
        as: 'categories',
        include: [{ model: db.Criterion, as: 'criteria' }],
      }],
      order: [['name', 'ASC']],
    });
    const plainScorecards = scorecards.map(sc => sc.get({ plain: true }));
    plainScorecards.forEach(sortChildrenInMemory);
    setToCache(ALL_SCORECARDS_CACHE_KEY, plainScorecards);
    return plainScorecards;
  } catch (err) {
    logError('Erro ao buscar todos os scorecards:', err);
    throw new Error('Não foi possível recuperar os scorecards do banco de dados.');
  }
};

/**
 * Busca um scorecard específico pelo seu ID com todas as associações.
 * Esta é a versão robusta que evita erros complexos de query do Sequelize.
 */
export const findById = async (id) => {
  const cacheKey = `${SCORECARDS_CACHE_PREFIX}${id}`;
  const cachedScorecard = getFromCache(cacheKey);
  if (cachedScorecard) {
    log(`CACHE HIT: Retornando scorecard ${id} do cache.`);
    return cachedScorecard;
  }
  
  try {
    // 1. Busca o scorecard principal primeiro.
    const scorecard = await db.Scorecard.findByPk(id);
    if (!scorecard) {
        log(`DB MISS: Scorecard com ID ${id} não encontrado no banco de dados.`);
        return null; // Retorna nulo explicitamente se não encontrar
    }

    // 2. Busca as categorias e critérios associados em uma query separada.
    const categories = await db.Category.findAll({
        where: { scorecardId: id },
        include: [{ model: db.Criterion, as: 'criteria' }],
    });

    // 3. Monta o objeto final em JavaScript.
    const plainScorecard = scorecard.get({ plain: true });
    plainScorecard.categories = categories.map(cat => cat.get({ plain: true }));

    // 4. Ordena as associações em memória.
    sortChildrenInMemory(plainScorecard);
    
    // 5. Salva no cache e retorna.
    setToCache(cacheKey, plainScorecard);
    log(`DB HIT: Scorecard com ID ${id} buscado do banco e salvo no cache.`);
    return plainScorecard;

  } catch (err) {
    logError(`Erro ao buscar scorecard com ID ${id}:`, err);
    throw new Error('Não foi possível recuperar o scorecard do banco de dados.');
  }
};

/**
 * Cria um novo scorecard com suas categorias e critérios.
 */
export const create = async (scorecardData) => {
  const t = await db.sequelize.transaction();
  try {
    const { categories, ...restOfData } = scorecardData;
    const newScorecard = await db.Scorecard.create(restOfData, { transaction: t });

    if (categories && categories.length > 0) {
      for (const [categoryIndex, categoryData] of categories.entries()) {
        const { criteria, ...restOfCategory } = categoryData;
        const newCategory = await db.Category.create({ 
            ...restOfCategory, 
            scorecardId: newScorecard.id,
            order: categoryIndex 
        }, { transaction: t });

        if (criteria && criteria.length > 0) {
          for (const [criterionIndex, criterionData] of criteria.entries()) {
            if (criterionData.name && criterionData.name.trim() !== '') {
              await db.Criterion.create({ 
                  ...criterionData, 
                  categoryId: newCategory.id,
                  order: criterionIndex 
              }, { transaction: t });
            }
          }
        }
      }
    }

    await t.commit();
    clearCacheByPrefix(SCORECARDS_CACHE_PREFIX);
    log(`Cache de scorecards invalidado após a criação de '${newScorecard.name}'.`);
    return findById(newScorecard.id);
  } catch (err) {
    await t.rollback();
    logError('Erro ao criar scorecard:', err);
    throw new Error('Falha ao criar o scorecard. A transação foi revertida.');
  }
};

/**
 * Atualiza um scorecard existente.
 */
export const update = async (id, scorecardData) => {
    const t = await db.sequelize.transaction();
    try {
        const scorecard = await db.Scorecard.findByPk(id, { transaction: t });
        if (!scorecard) throw new Error('Scorecard não encontrado.');

        const { categories, ...restOfData } = scorecardData;
        await scorecard.update(restOfData, { transaction: t });
        await db.Category.destroy({ where: { scorecardId: id }, transaction: t });

        if (categories && categories.length > 0) {
            for (const [categoryIndex, categoryData] of categories.entries()) {
                const { criteria, ...restOfCategory } = categoryData;
                const newCategory = await db.Category.create({ 
                    ...restOfCategory, 
                    scorecardId: id,
                    order: categoryIndex 
                }, { transaction: t });

                if (criteria && criteria.length > 0) {
                    for (const [criterionIndex, criterionData] of criteria.entries()) {
                        if (criterionData.name && criterionData.name.trim() !== '') {
                           await db.Criterion.create({ 
                               ...criterionData, 
                               categoryId: newCategory.id,
                               order: criterionIndex
                           }, { transaction: t });
                        }
                    }
                }
            }
        }

        await t.commit();
        clearCacheByPrefix(SCORECARDS_CACHE_PREFIX);
        log(`Cache de scorecards invalidado após a atualização de '${scorecard.name}'.`);
        return findById(id);
    } catch (err) {
        await t.rollback();
        logError(`Erro ao atualizar scorecard ${id}:`, err);
        throw new Error('Falha ao atualizar o scorecard. A transação foi revertida.');
    }
};

/**
 * Deleta um scorecard pelo seu ID.
 */
export const remove = async (id) => {
    const t = await db.sequelize.transaction();
    try {
        const scorecard = await db.Scorecard.findByPk(id, { transaction: t });
        if (!scorecard) {
            logError(`Tentativa de deletar scorecard não existente com ID: ${id}`);
            return false;
        }
        
        await scorecard.destroy({ transaction: t });
        
        await t.commit();
        clearCacheByPrefix(SCORECARDS_CACHE_PREFIX);
        log(`Cache de scorecards invalidado após a remoção do scorecard ${id}.`);
        return true;
    } catch (err) {
        await t.rollback();
        logError(`Erro ao deletar scorecard ${id}:`, err);
        throw new Error('Falha ao deletar o scorecard.');
    }
};