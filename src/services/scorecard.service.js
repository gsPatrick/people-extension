import db from '../models/index.js';
import { clearCacheByPrefix, getFromCache, setToCache } from '../utils/cache.service.js';
import { createEmbedding } from './embedding.service.js';
import { log, error as logError } from '../utils/logger.service.js';

const SCORECARDS_CACHE_PREFIX = 'scorecards_';
const ALL_SCORECARDS_CACHE_KEY = `${SCORECARDS_CACHE_PREFIX}all`;

/**
 * Garante que a estrutura dos dados retornados seja consistente.
 * Especificamente, assegura que 'category.criteria' seja sempre um array.
 * @param {object|object[]} scorecards - Um único scorecard ou uma lista de scorecards.
 * @returns {object|object[]} Os scorecards sanitizados.
 */
const sanitizeScorecards = (scorecards) => {
  if (!scorecards) return scorecards;

  const scorecardList = Array.isArray(scorecards) ? scorecards : [scorecards];

  for (const scorecard of scorecardList) {
    // Acessa os dados brutos para modificá-los antes de serem retornados
    const plainScorecard = scorecard.get({ plain: true });
    if (plainScorecard.categories) {
      for (const category of plainScorecard.categories) {
        // A LÓGICA CRUCIAL: Se 'criteria' for undefined/null, define como um array vazio.
        if (!category.criteria) {
          category.criteria = [];
        }
      }
    }
    // Retorna a versão modificada (ou a original se for uma lista)
    if (!Array.isArray(scorecards)) return plainScorecard;
  }
  
  // Para listas, retorna a lista completa após sanitizar cada item no objeto original
  return scorecards;
};


/**
 * Busca todos os scorecards com suas categorias e critérios aninhados.
 * @returns {Promise<Array>} Uma lista de scorecards.
 */
export const findAll = async () => {
  const cachedScorecards = getFromCache(ALL_SCORECARDS_CACHE_KEY);
  if (cachedScorecards) {
    log('CACHE HIT: Retornando todos os scorecards do cache.');
    return cachedScorecards;
  }

  try {
    let scorecards = await db.Scorecard.findAll({
      include: [
        {
          model: db.Category,
          as: 'categories',
          include: [
            {
              model: db.Criterion,
              as: 'criteria',
            },
          ],
        },
      ],
      order: [
        ['name', 'ASC'],
        [{ model: db.Category, as: 'categories' }, 'order', 'ASC'],
        [{ model: db.Category, as: 'categories' }, { model: db.Criterion, as: 'criteria' }, 'order', 'ASC'],
      ],
    });

    // Sanitiza os dados antes de cachear e retornar
    scorecards = sanitizeScorecards(scorecards);

    setToCache(ALL_SCORECARDS_CACHE_KEY, scorecards);
    return scorecards;
  } catch (err) {
    logError('Erro ao buscar todos os scorecards:', err.message);
    throw new Error('Não foi possível recuperar os scorecards do banco de dados.');
  }
};

/**
 * Busca um scorecard específico pelo seu ID com todas as associações.
 * @param {string} id - O UUID do scorecard.
 * @returns {Promise<Object|null>} O scorecard encontrado ou null.
 */
export const findById = async (id) => {
  const cacheKey = `${SCORECARDS_CACHE_PREFIX}${id}`;
  const cachedScorecard = getFromCache(cacheKey);
  if (cachedScorecard) {
    log(`CACHE HIT: Retornando scorecard ${id} do cache.`);
    return cachedScorecard;
  }
  
  try {
    let scorecard = await db.Scorecard.findByPk(id, {
        include: [
            {
              model: db.Category,
              as: 'categories',
              separate: true,
              include: [
                {
                  model: db.Criterion,
                  as: 'criteria',
                },
              ],
            },
        ],
        order: [
            [{ model: db.Category, as: 'categories' }, 'order', 'ASC'],
            [{ model: db.Category, as: 'categories' }, { model: db.Criterion, as: 'criteria' }, 'order', 'ASC'],
        ],
    });

    if (scorecard) {
        // Sanitiza os dados antes de cachear e retornar
        const sanitizedScorecard = sanitizeScorecards(scorecard);
        setToCache(cacheKey, sanitizedScorecard);
        return sanitizedScorecard;
    }
    return null;
  } catch (err) {
    logError(`Erro ao buscar scorecard com ID ${id}:`, err.message);
    throw new Error('Não foi possível recuperar o scorecard do banco de dados.');
  }
};

/**
 * Cria um novo scorecard com suas categorias e critérios.
 * @param {object} scorecardData - Os dados do scorecard a ser criado.
 * @returns {Promise<Object>} O scorecard recém-criado.
 */
export const create = async (scorecardData) => {
  const t = await db.sequelize.transaction();
  try {
    const { categories, ...restOfData } = scorecardData;
    const newScorecard = await db.Scorecard.create(restOfData, { transaction: t });

    if (categories && categories.length > 0) {
      for (const categoryData of categories) {
        const { criteria, ...restOfCategory } = categoryData;
        const newCategory = await db.Category.create({
          ...restOfCategory,
          scorecardId: newScorecard.id,
        }, { transaction: t });

        if (criteria && criteria.length > 0) {
          for (const criterionData of criteria) {
            if (criterionData.description && criterionData.description.trim() !== '') {
              const embedding = await createEmbedding(criterionData.description);
              await db.Criterion.create({ ...criterionData, embedding, categoryId: newCategory.id }, { transaction: t });
            }
          }
        }
      }
    }

    await t.commit();
    clearCacheByPrefix(SCORECARDS_CACHE_PREFIX);
    log(`Cache de scorecards invalidado após a criação de '${newScorecard.name}'.`);
    
    // O findById já sanitiza o resultado
    return findById(newScorecard.id);
  } catch (err) {
    await t.rollback();
    logError('Erro ao criar scorecard:', err.message);
    throw new Error('Falha ao criar o scorecard. A transação foi revertida.');
  }
};

/**
 * Atualiza um scorecard existente.
 * @param {string} id - O ID do scorecard a ser atualizado.
 * @param {object} scorecardData - Os novos dados para o scorecard.
 * @returns {Promise<Object>} O scorecard atualizado.
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
            for (const categoryData of categories) {
                const { criteria, ...restOfCategory } = categoryData;
                const newCategory = await db.Category.create({ ...restOfCategory, scorecardId: id }, { transaction: t });

                if (criteria && criteria.length > 0) {
                    for (const criterionData of criteria) {
                        if (criterionData.description && criterionData.description.trim() !== '') {
                            const embedding = await createEmbedding(criterionData.description);
                            await db.Criterion.create({ ...criterionData, embedding, categoryId: newCategory.id }, { transaction: t });
                        }
                    }
                }
            }
        }

        await t.commit();
        clearCacheByPrefix(SCORECARDEntityS_CACHE_PREFIX);
        log(`Cache de scorecards invalidado após a atualização de '${scorecard.name}'.`);
        
        // O findById já sanitiza o resultado
        return findById(id);
    } catch (err) {
        await t.rollback();
        logError(`Erro ao atualizar scorecard ${id}:`, err.message);
        throw new Error('Falha ao atualizar o scorecard. A transação foi revertida.');
    }
};

/**
 * Deleta um scorecard pelo seu ID.
 * @param {string} id - O ID do scorecard a ser deletado.
 * @returns {Promise<void>}
 */
export const remove = async (id) => {
    const t = await db.sequelize.transaction();
    try {
        const scorecard = await db.Scorecard.findByPk(id, { transaction: t });
        if (!scorecard) throw new Error('Scorecard não encontrado para deletar.');

        await scorecard.destroy({ transaction: t });
        await t.commit();
        clearCacheByPrefix(SCORECARDS_CACHE_PREFIX);
        log(`Cache de scorecards invalidado após a remoção do scorecard ${id}.`);
    } catch (err) {
        await t.rollback();
        logError(`Erro ao deletar scorecard ${id}:`, err.message);
        throw new Error('Falha ao deletar o scorecard.');
    }
};