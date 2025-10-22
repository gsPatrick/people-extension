// ARQUIVO COMPLETO E FINAL: src/services/scorecard.service.js

import db from '../models/index.js';
import { clearCacheByPrefix, getFromCache, setToCache } from '../utils/cache.service.js';
import { log, error as logError } from '../utils/logger.service.js';

const SCORECARDS_CACHE_PREFIX = 'scorecards_';
const ALL_SCORECARDS_CACHE_KEY = `${SCORECARDS_CACHE_PREFIX}all`;

/**
 * Função helper para ordenar os resultados em memória, em vez de na query SQL.
 * @param {object} data - O objeto scorecard ou categoria.
 */
const sortChildrenInMemory = (data) => {
    if (data.categories) {
        // Ordena as categorias
        data.categories.sort((a, b) => a.order - b.order);
        
        // Para cada categoria, ordena seus critérios
        data.categories.forEach(category => {
            if (category.criteria) {
                category.criteria.sort((a, b) => a.order - b.order);
            } else {
                category.criteria = []; // Garante que criteria sempre seja um array
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
      include: [
        {
          model: db.Category,
          as: 'categories',
          include: [{ model: db.Criterion, as: 'criteria' }],
        },
      ],
      // <-- MUDANÇA: Ordenação aninhada complexa removida da query principal.
      // Apenas a ordenação do scorecard principal permanece.
      order: [['name', 'ASC']],
    });

    const plainScorecards = scorecards.map(sc => sc.get({ plain: true }));

    // <-- MUDANÇA: Ordena as associações em JavaScript após a busca.
    plainScorecards.forEach(sortChildrenInMemory);

    setToCache(ALL_SCORECARDS_CACHE_KEY, plainScorecards);
    return plainScorecards;
  } catch (err) {
    logError('Erro ao buscar todos os scorecards:', err.message);
    throw new Error('Não foi possível recuperar os scorecards do banco de dados.');
  }
};

/**
 * Busca um scorecard específico pelo seu ID com todas as associações.
 */
export const findById = async (id) => {
  const cacheKey = `${SCORECARDS_CACHE_PREFIX}${id}`;
  const cachedScorecard = getFromCache(cacheKey);
  if (cachedScorecard) {
    log(`CACHE HIT: Retornando scorecard ${id} do cache.`);
    return cachedScorecard;
  }
  
  try {
    const scorecard = await db.Scorecard.findByPk(id, {
      include: [
        {
          model: db.Category,
          as: 'categories',
          separate: true,
          include: [{ model: db.Criterion, as: 'criteria' }],
        },
      ],
      // <-- MUDANÇA: A cláusula 'order' complexa foi totalmente removida daqui.
    });

    if (scorecard) {
      const plainScorecard = scorecard.get({ plain: true });
      
      // <-- MUDANÇA: Ordena as associações em JavaScript após a busca.
      sortChildrenInMemory(plainScorecard);
      
      setToCache(cacheKey, plainScorecard);
      return plainScorecard;
    }
    return null;
  } catch (err) {
    logError(`Erro ao buscar scorecard com ID ${id}:`, err.message);
    throw new Error('Não foi possível recuperar o scorecard do banco de dados.');
  }
};

// As funções create, update e remove não precisam de alterações e permanecem como estão.
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
    logError('Erro ao criar scorecard:', err.message);
    throw new Error('Falha ao criar o scorecard. A transação foi revertida.');
  }
};

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
        logError(`Erro ao atualizar scorecard ${id}:`, err.message);
        throw new Error('Falha ao atualizar o scorecard. A transação foi revertida.');
    }
};

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
        logError(`Erro ao deletar scorecard ${id}:`, err.message);
        throw new Error('Falha ao deletar o scorecard.');
    }
};