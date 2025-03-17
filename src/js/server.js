require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const crypto = require('crypto');

// Import database connection and models
const connectDB = require('../config/database');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const app = express();
const port = process.env.PORT || 3000;

// Connect to MongoDB
connectDB();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/css', express.static('src/css'));
app.set('view engine', 'ejs');
app.set('views', './views');

// Configuração da sessão com MongoDB
app.use(session({
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 30 * 24 * 60 * 60 // 30 dias em segundos
    }),
    secret: process.env.SESSION_SECRET || 'your_session_secret_here',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000 // 30 dias
    }
}));

// Configuração do Multer para upload de arquivos (memória para Vercel)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB
    }
});

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Middleware de autenticação
function requireLogin(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Rotas
app.get('/', (req, res) => {
    res.render('login');
});

app.get('/login', (req, res) => {
    const messages = {};
    if (req.query.verification_pending === 'true') {
        messages.success = 'Registro realizado! Por favor, verifique seu email para ativar sua conta.';
    }
    res.render('login', { messages });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const user = await User.findOne({ email });

        if (user && await bcrypt.compare(password, user.password)) {
            if (!user.verified) {
                return res.render('login', { 
                    messages: { 
                        error: 'Por favor, verifique seu email antes de fazer login' 
                    } 
                });
            }

            req.session.userId = user._id;
            res.redirect('/dashboard');
        } else {
            res.render('login', { 
                messages: { 
                    error: 'Email ou senha incorretos' 
                } 
            });
        }
    } catch (error) {
        console.error('Erro no login:', error);
        res.render('login', { 
            messages: { 
                error: 'Erro ao fazer login' 
            } 
        });
    }
});

app.get('/register', (req, res) => {
    res.render('register', { messages: {} });
});

app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;
    
    try {
        // Verificar se o email já existe
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.render('register', { 
                messages: { 
                    error: 'Este email já está registrado' 
                } 
            });
        }

        // Criar hash da senha
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Gerar token de verificação
        const verificationToken = crypto.randomBytes(32).toString('hex');

        // Criar novo usuário
        const user = new User({
            name,
            email,
            password: hashedPassword,
            verificationToken,
            verified: false
        });

        await user.save();

        // Enviar email de verificação
        const verificationLink = `${req.protocol}://${req.get('host')}/verify/${verificationToken}`;
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Verifique seu email - Gestão Financeira',
            html: `
                <h1>Bem-vindo ao Gestão Financeira!</h1>
                <p>Por favor, clique no link abaixo para verificar seu email:</p>
                <a href="${verificationLink}">${verificationLink}</a>
            `
        };

        await transporter.sendMail(mailOptions);
        
        res.render('login', { 
            messages: { 
                success: 'Registro realizado! Por favor, verifique seu email para ativar sua conta.',
                showResend: true
            } 
        });
    } catch (error) {
        console.error('Erro no registro:', error);
        res.render('register', { 
            messages: { 
                error: 'Erro ao registrar usuário' 
            } 
        });
    }
});

// Rota para verificação de email
app.get('/verify/:token', async (req, res) => {
    const { token } = req.params;
    
    try {
        const user = await User.findOneAndUpdate(
            { verificationToken: token },
            { 
                $set: { verified: true },
                $unset: { verificationToken: "" }
            }
        );

        if (!user) {
            return res.render('login', { messages: { error: 'Token de verificação inválido' } });
        }

        res.render('login', { messages: { success: 'Email verificado com sucesso! Você já pode fazer login.' } });
    } catch (error) {
        console.error('Erro ao verificar email:', error);
        res.render('login', { messages: { error: 'Erro ao verificar email' } });
    }
});

app.get('/dashboard', requireLogin, (req, res) => {
    const userId = req.session.userId;
    
    // Obter todas as transações do usuário
    Transaction.find({ user_id: userId })
        .sort({ date: -1 })
        .limit(5)
        .exec((err, transactions) => {
            if (err) {
                console.error('Erro ao buscar transações:', err);
                return res.render('dashboard', { 
                    user: req.session.user,
                    totalBalance: 0,
                    monthlyIncome: 0,
                    monthlyExpenses: 0,
                    transactions: [],
                    expenseCategories: [],
                    expenseAmounts: [],
                    monthlyLabels: [],
                    monthlyIncomeData: [],
                    monthlyExpenseData: [],
                    error: 'Erro ao carregar dados'
                });
            }

            // Calcular saldo total e valores mensais
            const currentDate = new Date();
            const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
            
            let totalBalance = 0;
            let monthlyIncome = 0;
            let monthlyExpenses = 0;
            
            // Para o gráfico de categorias
            const expensesByCategory = {};
            
            // Para o gráfico mensal
            const monthlyData = {};
            
            transactions.forEach(transaction => {
                const amount = parseFloat(transaction.amount);
                const transactionDate = new Date(transaction.date);
                const monthKey = `${transactionDate.getFullYear()}-${(transactionDate.getMonth() + 1).toString().padStart(2, '0')}`;
                
                // Inicializar dados mensais se não existirem
                if (!monthlyData[monthKey]) {
                    monthlyData[monthKey] = { income: 0, expenses: 0 };
                }
                
                // Atualizar saldo total e dados mensais
                if (transaction.type === 'INCOME') {
                    totalBalance += amount;
                    monthlyData[monthKey].income += amount;
                    // Se for deste mês, adicionar à receita mensal
                    if (transactionDate >= firstDayOfMonth) {
                        monthlyIncome += amount;
                    }
                } else if (transaction.type === 'EXPENSE') {
                    totalBalance -= amount;
                    monthlyData[monthKey].expenses += amount;
                    // Se for deste mês, adicionar à despesa mensal
                    if (transactionDate >= firstDayOfMonth) {
                        monthlyExpenses += amount;
                    }
                    // Adicionar à categoria de despesas
                    if (!expensesByCategory[transaction.category]) {
                        expensesByCategory[transaction.category] = 0;
                    }
                    expensesByCategory[transaction.category] += amount;
                }
            });

            // Preparar dados para os gráficos
            const expenseCategories = Object.keys(expensesByCategory);
            const expenseAmounts = expenseCategories.map(category => expensesByCategory[category]);

            // Preparar dados mensais (últimos 6 meses)
            const sortedMonths = Object.keys(monthlyData).sort().slice(-6);
            const monthlyLabels = sortedMonths.map(month => {
                const [year, monthNum] = month.split('-');
                return `${monthNum}/${year}`;
            });
            const monthlyIncomeData = sortedMonths.map(month => monthlyData[month].income);
            const monthlyExpenseData = sortedMonths.map(month => monthlyData[month].expenses);

            // Renderizar dashboard com todos os dados
            res.render('dashboard', {
                user: req.session.user,
                totalBalance: totalBalance.toFixed(2),
                monthlyIncome: monthlyIncome.toFixed(2),
                monthlyExpenses: monthlyExpenses.toFixed(2),
                transactions: transactions,
                expenseCategories,
                expenseAmounts,
                monthlyLabels,
                monthlyIncomeData,
                monthlyExpenseData,
                error: null
            });
        });
});

// Rota para reenviar email de verificação
app.post('/resend-verification', async (req, res) => {
    const { email } = req.body;
    
    try {
        const user = await User.findOne({ email });
        
        if (!user || user.verified) {
            return res.json({ 
                success: false, 
                message: 'Este email já está verificado' 
            });
        }
        
        // Gerar novo token de verificação
        const verificationToken = crypto.randomBytes(32).toString('hex');
        
        // Atualizar token no banco
        user.verificationToken = verificationToken;
        await user.save();
        
        // Enviar email de verificação
        const verificationLink = `${req.protocol}://${req.get('host')}/verify/${verificationToken}`;
        const emailHtml = `
            <h1>Verificação de Email - Gestão Financeira</h1>
            <p>Olá ${user.name},</p>
            <p>Por favor, clique no link abaixo para verificar seu email:</p>
            <a href="${verificationLink}">${verificationLink}</a>
            <p>Se você não solicitou este email, por favor ignore.</p>
        `;
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Verificação de Email - Gestão Financeira',
            html: emailHtml
        };
        
        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Email de verificação reenviado com sucesso' 
        });
    } catch (error) {
        console.error('Erro ao reenviar email de verificação:', error);
        res.json({ 
            success: false, 
            message: 'Erro ao reenviar email de verificação' 
        });
    }
});

// Rota para adicionar transação
app.post('/transaction/add', requireLogin, upload.single('receipt'), (req, res) => {
    const userId = req.session.userId;
    const { type, amount, description, category, recurring, recurrencePeriod } = req.body;
    const date = new Date().toISOString();
    const receiptUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // Validar dados
    if (!type || !amount || !description || !category) {
        return res.status(400).json({ 
            success: false, 
            message: 'Todos os campos obrigatórios devem ser preenchidos' 
        });
    }

    // Inserir transação no banco de dados
    const transaction = new Transaction({
        user_id: userId,
        type,
        amount,
        description,
        category,
        date,
        receipt_path: receiptUrl
    });

    transaction.save((err, result) => {
        if (err) {
            console.error('Erro ao adicionar transação:', err);
            return res.status(500).json({ 
                success: false, 
                message: 'Erro ao adicionar transação' 
            });
        }

        // Se for uma transação recorrente, agendar próximas ocorrências
        if (recurring === 'on') {
            // Aqui você pode implementar a lógica para transações recorrentes
            // Por exemplo, criar transações futuras com base no período
        }

        // Redirecionar para o dashboard com mensagem de sucesso
        res.redirect('/dashboard?success=true');
    });
});

// Rota para criar conta de teste (já verificada)
app.get('/create-test-account', (req, res) => {
    const testUser = {
        name: 'Usuário Teste',
        email: 'teste@teste.com',
        password: '123456'
    };
    
    // Primeiro, verificar se a conta já existe
    User.findOne({ email: testUser.email }, (err, existingUser) => {
        if (err) {
            console.error('Erro ao verificar usuário:', err);
            return res.send('Erro ao verificar se a conta existe.');
        }
        
        if (existingUser) {
            // Se a conta existe, apenas mostrar as credenciais
            return res.send(`
                <h1>Conta de teste já existe!</h1>
                <p>Use estas credenciais para fazer login:</p>
                <p>Email: ${testUser.email}</p>
                <p>Senha: ${testUser.password}</p>
                <p><a href="/login">Ir para o login</a></p>
            `);
        }
        
        // Se não existe, criar nova conta
        const hashedPassword = bcrypt.hashSync(testUser.password, 10);
        
        const user = new User({
            name: testUser.name,
            email: testUser.email,
            password: hashedPassword,
            verified: true
        });

        user.save((err, result) => {
            if (err) {
                console.error('Erro ao criar conta:', err);
                return res.send('Erro ao criar conta de teste.');
            }
            
            res.send(`
                <h1>Conta de teste criada com sucesso!</h1>
                <p>Use estas credenciais para fazer login:</p>
                <p>Email: ${testUser.email}</p>
                <p>Senha: ${testUser.password}</p>
                <p><a href="/login">Ir para o login</a></p>
            `);
        });
    });
});

// Rota para página de recuperação de senha
app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { messages: {} });
});

// Rota para solicitar recuperação de senha
app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    
    try {
        const user = await User.findOne({ email });
        
        if (!user) {
            return res.render('forgot-password', { 
                messages: { error: 'Email não encontrado' }
            });
        }
        
        // Gerar token de recuperação
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        // Salvar token no banco
        user.reset_token = resetToken;
        user.reset_token_expires = new Date(Date.now() + 3600000); // 1 hora de validade
        await user.save();
        
        // Enviar email com link de recuperação
        const resetLink = `${req.protocol}://${req.get('host')}/reset-password/${resetToken}`;
        const emailHtml = `
            <h1>Recuperação de Senha - Gestão Financeira</h1>
            <p>Olá ${user.name},</p>
            <p>Você solicitou a recuperação de senha. Clique no link abaixo para redefinir sua senha:</p>
            <a href="${resetLink}">${resetLink}</a>
            <p>Se você não solicitou a recuperação de senha, por favor ignore este email.</p>
            <p>Este link expira em 1 hora.</p>
        `;
        
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Recuperação de Senha - Gestão Financeira',
            html: emailHtml
        };
        
        await transporter.sendMail(mailOptions);
        
        res.render('forgot-password', { 
            messages: { 
                success: 'Email de recuperação enviado. Por favor, verifique sua caixa de entrada.' 
            }
        });
    } catch (error) {
        console.error('Erro ao solicitar recuperação de senha:', error);
        res.render('forgot-password', { 
            messages: { 
                error: 'Erro ao solicitar recuperação de senha' 
            }
        });
    }
});

// Rota para página de redefinição de senha
app.get('/reset-password/:token', (req, res) => {
    const { token } = req.params;
    
    // Verificar se o token existe e não expirou (1 hora de validade)
    const oneHourAgo = new Date(Date.now() - 3600000); // 1 hora atrás
    
    User.findOne({ reset_token: token, reset_token_expires: { $gt: oneHourAgo } }, (err, user) => {
        if (err || !user) {
            return res.render('login', { 
                messages: { error: 'Link de recuperação inválido ou expirado' }
            });
        }
        
        res.render('reset-password', { token, messages: {} });
    });
});

// Rota para processar redefinição de senha
app.post('/reset-password/:token', (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;
    
    if (password !== confirmPassword) {
        return res.render('reset-password', { 
            token,
            messages: { error: 'As senhas não coincidem' }
        });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    User.findOneAndUpdate(
        { reset_token: token },
        { 
            $set: {
                password: hashedPassword,
                reset_token: null,
                reset_token_expires: null
            }
        },
        (err, result) => {
            if (err || !result) {
                return res.render('reset-password', { 
                    token,
                    messages: { error: 'Erro ao redefinir senha' }
                });
            }
            
            res.render('login', { 
                messages: { success: 'Senha redefinida com sucesso! Você já pode fazer login.' }
            });
        }
    );
});

// Rota de logout
app.get('/logout', (req, res) => {
    // Destruir a sessão
    req.session.destroy((err) => {
        if (err) {
            console.error('Erro ao fazer logout:', err);
        }
        // Redirecionar para a página de login
        res.redirect('/login');
    });
});

// Inicializar banco de dados e iniciar servidor
connectDB().then(() => {
    app.listen(port, () => {
        console.log(`Servidor rodando em http://localhost:${port}`);
    });
}); 