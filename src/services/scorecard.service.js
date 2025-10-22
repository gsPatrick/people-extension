import db from '../models/index.js';
import { clearCacheByPrefix, getFromCache, setToCache } from '../utils/cache.service.js';
import { createEmbedding } from './embedding.service.js';
import { log, error as logError } from '../utils/logger.service.js';

const SCORECARDS_CACHE_PREFIX = 'scorecards_';
const ALL_SCORECARDS_CACHE_KEY = `${SCORECARDS_CACHE_PREFIX}all`;

/**
 * Busca todos os scorecards com suas categorias e critérios aninhados.
 * Utiliza cache para otimizar as leituras.
 * @returns {Promise<Array>} Uma lista de scorecards.
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
    const scorecard = await db.Scorecard.findByPk(id, {
        include: [
            {
              model: db.Category,
              as: 'categories',
              separate: true, // Otimiza a query para 'hasMany'
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
        setToCache(cacheKey, scorecard);
    }
    return scorecard;
  } catch (err) {
    logError(`Erro ao buscar scorecard com ID ${id}:`, err.message);
    throw new Error('Não foi possível recuperar o scorecard do banco de dados.');
  }
};

/**
 * Cria um novo scorecard com suas categorias e critérios.
 * Ignora critérios que não possuem uma descrição válida.
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
            // Validação crucial: Processa e cria o critério APENAS se ele tiver uma descrição válida.
            if (criterionData.description && criterionData.description.trim() !== '') {
              const embedding = await createEmbedding(criterionData.description);
              await db.Criterion.create({
                ...criterionData,
                embedding, // Agora 'embedding' nunca será nulo
                categoryId: newCategory.id,
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

/**
 * Atualiza um scorecard existente.
 * Adota uma abordagem de "substituição" para categorias e critérios.
 * Ignora critérios que não possuem uma descrição válida.
 * @param {string} id - O ID do scorecard a ser atualizado.
 * @param {object} scorecardData - Os novos dados para o scorecard.
 * @returns {Promise<Object>} O scorecard atualizado.
 */
export const update = async (id, scorecardData) => {
    const t = await db.sequelize.transaction();
    try {
        const scorecard = await db.Scorecard.findByPk(id, { transaction: t });
        if (!scorecard) {
            throw new Error('Scorecard não encontrado.');
        }

        const { categories, ...restOfData } = scorecardData;

        await scorecard.update(restOfData, { transaction: t });
        await db.Category.destroy({ where: { scorecardId: id }, transaction: t });

        if (categories && categories.length > 0) {
            for (const categoryData of categories) {
                const { criteria, ...restOfCategory } = categoryData;
                const newCategory = await db.Category.create({
                    ...restOfCategory,
                    scorecardId: id,
                }, { transaction: t });

                if (criteria && criteria.length > 0) {
                    for (const criterionData of criteria) {
                        // Validação crucial: Aplica a mesma lógica de validação na atualização.
                        if (criterionData.description && criterionData.description.trim() !== '') {
                            const embedding = await createEmbedding(criterionData.description);
                            await db.Criterion.create({
                                ...criterionData,
                                embedding,
                                categoryId: newCategory.id,
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

/**
 * Deleta um scorecard pelo seu ID.
 * @param {string} id - O ID do scorecard a ser deletado.
 * @returns {Promise<void>}
 */
export const remove = async (id) => {
    const t = await db.sequelize.transaction();
    try {
        const scorecard = await db.Scorecard.findByPk(id, { transaction: t });
        if (!scorecard) {
            throw new Error('Scorecard não encontrado para deletar.');
        }

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