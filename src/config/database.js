import 'dotenv/config';

// Define a configuração em uma constante
const config = {
  development: {
    // Para desenvolvimento, sempre usamos os campos individuais.
    // Isso evita o erro quando DATABASE_URL não está definido.
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    dialectOptions: {
      ssl: process.env.DB_SSL === 'true' ? { require: true, rejectUnauthorized: false } : false
    },
    logging: false,
  },
  production: {
    // Para produção, priorizamos a URL de conexão, que é o padrão em serviços como Heroku/Render.
    // Se a URL não estiver definida, ele tentará usar os campos individuais.
    use_env_variable: 'DATABASE_URL', // Esta chave é específica para o Sequelize CLI, não para a inicialização do Sequelize
    url: process.env.DATABASE_URL, // Usaremos esta URL diretamente no nosso código
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    dialectOptions: {
      ssl: { require: true, rejectUnauthorized: false }
    },
  }
};

// Exporta a configuração
export default config;