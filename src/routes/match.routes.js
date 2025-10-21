import { Router } from 'express';
import * as matchController from '../controllers/match.controller.js';

const router = Router();

/**
 * @swagger
 * /api/match/{scorecardId}:
 *   post:
 *     summary: Analisa um perfil do LinkedIn contra um scorecard específico.
 *     description: Recebe os dados de um perfil scrapeado e retorna uma análise de match instantânea baseada em similaridade vetorial.
 *     tags: [Match]
 *     parameters:
 *       - in: path
 *         name: scorecardId
 *         required: true
 *         schema:
 *           type: string
 *         description: O ID do scorecard a ser usado para a análise.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             description: O objeto JSON completo retornado pelo script de scraping do LinkedIn.
 *     responses:
 *       200:
 *         description: Análise de match bem-sucedida.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/MatchResult'
 *       400:
 *         description: Dados de entrada inválidos (scorecardId faltando ou corpo da requisição vazio).
 *       404:
 *         description: Scorecard não encontrado.
 *       500:
 *         description: Erro interno no servidor durante a análise.
 */
router.post('/:scorecardId', matchController.analyzeProfile);

export default router;