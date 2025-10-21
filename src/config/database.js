import 'dotenv/config';

// Define a configuração em uma constante
const config = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? { require: true, rejectUnauthorized: false } : false
    },
    logging: false, // Recomendo manter false para não poluir os logs
  },
  production: {
    // Adicione aqui as configurações para o ambiente de produção
    // Geralmente usa uma URL de conexão
    use_env_variable: 'DATABASE_URL',
    dialect: 'postgres',
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    },
  }
};

// Exporta a configuração como default
export default config;