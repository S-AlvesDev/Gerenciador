const mongoose = require('mongoose');

let cachedConnection = null;
let isConnecting = false;
let retryCount = 0;
const MAX_RETRIES = 3;

const connectDB = async () => {
    // Se já estiver conectado, retorna a conexão existente
    if (cachedConnection && mongoose.connection.readyState === 1) {
        return cachedConnection;
    }

    // Se já estiver tentando conectar, aguarda
    if (isConnecting) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return connectDB();
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI não está definido nas variáveis de ambiente');
    }

    try {
        isConnecting = true;

        const opts = {
            serverSelectionTimeoutMS: 30000, // Aumentado para 30 segundos
            socketTimeoutMS: 45000,
            family: 4,
            maxPoolSize: 10,
            minPoolSize: 1,
            maxIdleTimeMS: 10000,
            connectTimeoutMS: 30000, // Aumentado para 30 segundos
            retryWrites: true,
            retryReads: true,
            w: 'majority',
            wtimeoutMS: 30000,
        };

        // Limpar conexão anterior se existir
        if (cachedConnection) {
            await mongoose.connection.close();
            cachedConnection = null;
        }

        // Tentar conectar
        const conn = await mongoose.connect(process.env.MONGODB_URI, opts);
        cachedConnection = conn;
        retryCount = 0; // Resetar contador de tentativas após sucesso
        
        console.log(`MongoDB conectado: ${conn.connection.host}`);
        
        // Adicionar listeners para eventos de conexão
        mongoose.connection.on('error', err => {
            console.error('Erro na conexão MongoDB:', err);
            cachedConnection = null;
            isConnecting = false;
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB desconectado');
            cachedConnection = null;
            isConnecting = false;
        });

        mongoose.connection.on('connected', () => {
            console.log('MongoDB reconectado');
            isConnecting = false;
        });

        // Tratamento de erros não capturados
        process.on('unhandledRejection', (err) => {
            console.error('Erro não tratado:', err);
            if (err.name === 'MongooseError' || err.name === 'MongoError') {
                cachedConnection = null;
            }
        });

        return conn;
    } catch (error) {
        console.error('Erro ao conectar ao MongoDB:', error);
        cachedConnection = null;
        isConnecting = false;

        // Tentar reconectar se não excedeu o número máximo de tentativas
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`Tentativa ${retryCount} de ${MAX_RETRIES}. Tentando reconectar em 5 segundos...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
            return connectDB();
        }

        throw error;
    }
};

module.exports = connectDB; 