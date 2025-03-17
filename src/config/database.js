const mongoose = require('mongoose');

let cachedConnection = null;

const connectDB = async () => {
    if (cachedConnection) {
        return cachedConnection;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI não está definido nas variáveis de ambiente');
    }

    try {
        const opts = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        };

        const conn = await mongoose.connect(process.env.MONGODB_URI, opts);
        cachedConnection = conn;
        
        console.log(`MongoDB conectado: ${conn.connection.host}`);
        
        // Adicionar listeners para eventos de conexão
        mongoose.connection.on('error', err => {
            console.error('Erro na conexão MongoDB:', err);
        });

        mongoose.connection.on('disconnected', () => {
            console.log('MongoDB desconectado');
            cachedConnection = null;
        });

        return conn;
    } catch (error) {
        console.error('Erro ao conectar ao MongoDB:', error);
        throw error;
    }
};

module.exports = connectDB; 