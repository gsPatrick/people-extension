// ARQUIVO COMPLETO E CORRIGIDO: src/services/scorecard.service.js

import db from '../models/index.js';
import { clearCacheByPrefix, getFromCache, setToCache } from '../utils/cache.service.js';
import { log, error as logError } from '../utils/logger.service.js';

const SCORECARDS_CACHE_PREFIX = 'scorecards_';
const ALL_SCORECARDS_CACHE_KEY = `${SCORECARDS_CACHE_PREFIX}all`;

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
      order: [
        ['name', 'ASC'],
        // <-- MUDANÇA DE SINTAXE AQUI -->
        // A ordenação por associação precisa ser um array aninhado
        [ { model: db.Category, as: 'categories' }, 'order', 'ASC' ],
        [ { model: db.Category, as: 'categories' }, { model: db.Criterion, as: 'criteria' }, 'order', 'ASC' ],
      ],
    });

    const plainScorecards = scorecards.map(sc => sc.get({ plain: true }));

    for (const scorecard of plainScorecards) {
      if (scorecard.categories) {
        for (const category of scorecard.categories) {
          if (!category.criteria) {
            category.criteria = [];
          }
        }
      }
    }

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
      order: [
        // <-- MUDANÇA DE SINTAXE AQUI TAMBÉM -->
        [ { model: db.Category, as: 'categories' }, 'order', 'ASC' ],
        [ { model: db.Category, as: 'categories' }, { model: db.Criterion, as: 'criteria' }, 'order', 'ASC' ],
      ],
    });

    if (scorecard) {
      const plainScorecard = scorecard.get({ plain: true });
      if (plainScorecard.categories) {
        for (const category of plainScorecard.categories) {
          if (!category.criteria) {
            category.criteria = [];
          }
        }
      }
      setToCache(cacheKey, plainScorecard);
      return plainScorecard;
    }
    return null;
  } catch (err) {
    logError(`Erro ao buscar scorecard com ID ${id}:`, err.message);
    throw new Error('Não foi possível recuperar o scorecard do banco de dados.');
  }
};

// As funções create, update e remove permanecem as mesmas da versão anterior.
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