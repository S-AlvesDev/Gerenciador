const mongoose = require('mongoose');

let cachedConnection = null;

const connectDB = async () => {
    if (cachedConnection && mongoose.connection.readyState === 1) {
        return cachedConnection;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI não está definido nas variáveis de ambiente');
    }

    try {
        const opts = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            family: 4,
            maxPoolSize: 10,
            minPoolSize: 1,
            maxIdleTimeMS: 10000,
            connectTimeoutMS: 10000,
        };

        // Limpar conexão anterior se existir
        if (cachedConnection) {
            await mongoose.connection.close();
            cachedConnection = null;
        }

        const conn = await mongoose.connect(process.env.MONGODB_URI, opts);
        cachedConnection = conn;
        
        console.log(`MongoDB conectado: ${conn.connection.host}`);
        
        // Adicionar listeners para eventos de conexão
        mongoose.connection.on('error', err => {
            console.error('Erro na conexão MongoDB:', err);
            cachedConnection = null;
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB desconectado');
            cachedConnection = null;
        });

        mongoose.connection.on('connected', () => {
            console.log('MongoDB reconectado');
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
        throw error;
    }
};

module.exports = connectDB; 