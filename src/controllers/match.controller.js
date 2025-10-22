import * as matchService from '../services/match.service.js';
import { log, error as logError } from '../utils/logger.service.js';

/**
 * Manipulador para analisar um perfil. Extrai dados da requisição,
 * chama o serviço de match e envia a resposta.
 */
export const analyzeProfile = async (req, res) => {
  const { scorecardId } = req.params;
  const profileData = req.body;

  // Validação básica de entrada
  if (!scorecardId) {
    return res.status(400).json({ message: 'O ID do Scorecard é obrigatório.' });
  }
  if (!profileData || Object.keys(profileData).length === 0) {
    return res.status(400).json({ message: 'O corpo da requisição (dados do perfil) não pode estar vazio.' });
  }

  try {
    log(`Controller recebendo requisição de análise para o scorecard: ${scorecardId}`);
    
    // Chama a função de serviço com a lógica de negócio
    const matchResult = await matchService.analyze(scorecardId, profileData);
    
    // Envia o resultado com sucesso
    res.status(200).json(matchResult);

  } catch (err) {
    logError(`Erro no controller de match: ${err.message}`);
    
    // Responde com o status code definido no serviço (ex: 404) ou um 500 genérico
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ message: err.message || 'Ocorreu um erro interno no servidor.' });
  }
};