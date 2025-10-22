// A importação agora aponta para o arquivo index.js específico
import { Scorecard, Category, Criterion, sequelize } from '../models/index.js';
import { createEmbeddings } from './embedding.service.js';
import { getFromCache, setToCache, clearCache } from '../utils/cache.service.js';
import { log, error } from '../utils/logger.service.js';

const ALL_SCORECARDS_CACHE_KEY = 'scorecards_all_list';
const SCORECARD_ID_CACHE_PREFIX = 'scorecard_id_';

/**
 * Cria um novo scorecard.
 */
export const create = async (scorecardData) => {
  const transaction = await sequelize.transaction();
  try {
    log(`Iniciando criação do scorecard: "${scorecardData.name}"`);

    const scorecard = await Scorecard.create({
      name: scorecardData.name,
      atsIntegration: scorecardData.atsIntegration,
      externalId: scorecardData.externalId,
    }, { transaction });

    for (const [catIndex, catData] of scorecardData.categories.entries()) {
      const category = await Category.create({
        name: catData.name,
        scorecardId: scorecard.id,
        order: catIndex,
      }, { transaction });

      const validCriteria = catData.criteria?.filter(c => c.name && c.name.trim());
      if (validCriteria?.length > 0) {
        const criteriaTextsForEmbedding = validCriteria.map(c => `${c.name}: ${c.description || ''}`);
        const embeddings = await createEmbeddings(criteriaTextsForEmbedding);

        const criteriaToCreate = validCriteria.map((crit, critIndex) => ({
          name: crit.name,
          description: crit.description,
          weight: crit.weight || 2,
          embedding: embeddings[critIndex],
          categoryId: category.id,
          order: critIndex,
        }));
        await Criterion.bulkCreate(criteriaToCreate, { transaction });
      }
    }

    await transaction.commit();
    clearCache(ALL_SCORECARDS_CACHE_KEY);

    log(`Scorecard "${scorecard.name}" criado com sucesso.`);
    return findById(scorecard.id);
  } catch (err) {
    await transaction.rollback();
    error('Erro transacional ao criar scorecard:', err.message);
    throw err;
  }
};

/**
 * Busca todos os scorecards. Otimizado com cache.
 */
export const findAll = async () => {
  const cachedScorecards = getFromCache(ALL_SCORECARDS_CACHE_KEY);
  if (cachedScorecards) return cachedScorecards;

  log("Buscando todos os scorecards do banco de dados (SQLite)...");
  const scorecards = await Scorecard.findAll({
    order: [['name', 'ASC']],
    include: [{
      model: Category,
      as: 'categories',
      separate: true,
      order: [['order', 'ASC']],
      include: [{
        model: Criterion,
        as: 'criteria',
        attributes: { exclude: ['embedding'] },
        order: [['order', 'ASC']],
      }],
    }],
  });

  setToCache(ALL_SCORECARDS_CACHE_KEY, scorecards);
  return scorecards;
};

/**
 * Busca um scorecard por ID. Otimizado com cache.
 */
export const findById = async (id) => {
  const cacheKey = `${SCORECARD_ID_CACHE_PREFIX}${id}`;
  const cachedScorecard = getFromCache(cacheKey);
  if (cachedScorecard) return cachedScorecard;

  log(`Buscando scorecard ID ${id} do banco de dados (SQLite)...`);
  const scorecard = await Scorecard.findByPk(id, {
    include: [{
      model: Category,
      as: 'categories',
      include: [{
        model: Criterion,
        as: 'criteria',
      }],
    }],
    order: [
      [{ model: Category, as: 'categories' }, 'order', 'ASC'],
      [{ model: Category, as: 'categories' }, { model: Criterion, as: 'criteria' }, 'order', 'ASC']
    ],
  });
  
  if (scorecard) {
    setToCache(cacheKey, scorecard);
  }
  return scorecard;
};

/**
 * Atualiza um scorecard.
 */
export const update = async (id, scorecardData) => {
  const transaction = await sequelize.transaction();
  try {
    const scorecard = await Scorecard.findByPk(id, { transaction });
    if (!scorecard) return null;

    await Category.destroy({ where: { scorecardId: id }, transaction });
    
    scorecard.name = scorecardData.name;
    await scorecard.save({ transaction });

    for (const [catIndex, catData] of scorecardData.categories.entries()) {
      const category = await Category.create({ name: catData.name, scorecardId: id, order: catIndex }, { transaction });
      const validCriteria = catData.criteria?.filter(c => c.name && c.name.trim());
      if (validCriteria?.length > 0) {
        const criteriaTextsForEmbedding = validCriteria.map(c => `${c.name}: ${c.description || ''}`);
        const embeddings = await createEmbeddings(criteriaTextsForEmbedding);
        const criteriaToCreate = validCriteria.map((crit, critIndex) => ({
          name: crit.name,
          description: crit.description,
          weight: crit.weight || 2,
          embedding: embeddings[critIndex],
          categoryId: category.id,
          order: critIndex,
        }));
        await Criterion.bulkCreate(criteriaToCreate, { transaction });
      }
    }

    await transaction.commit();
    clearCache(ALL_SCORECARDS_CACHE_KEY);
    clearCache(`${SCORECARD_ID_CACHE_PREFIX}${id}`);

    log(`Scorecard "${scorecard.name}" atualizado com sucesso.`);
    return findById(id);
  } catch (err) {
    await transaction.rollback();
    error(`Erro transacional ao atualizar scorecard ${id}:`, err.message);
    throw err;
  }
};

/**
 * Remove um scorecard por ID.
 */
export const remove = async (id) => {
  const scorecard = await Scorecard.findByPk(id);
  if (!scorecard) return false;

  await scorecard.destroy();

  clearCache(ALL_SCORECARDS_CACHE_KEY);
  clearCache(`${SCORECARD_ID_CACHE_PREFIX}${id}`);

  log(`Scorecard ID ${id} deletado com sucesso.`);
  return true;
};