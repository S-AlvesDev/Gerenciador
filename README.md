# Sistema de Gestão Financeira

Um sistema web para gerenciamento de finanças pessoais com autenticação de usuários, dashboard financeiro e funcionalidades de controle de gastos.

## Funcionalidades

- Autenticação de usuários com verificação de email
- Dashboard financeiro com gráficos e resumos
- Registro de receitas e despesas
- Categorização de transações
- Upload de comprovantes
- Modo escuro/claro
- Design responsivo

## Tecnologias Utilizadas

- Node.js
- Express.js
- PostgreSQL
- EJS (Template Engine)
- Nodemailer (Envio de emails)
- Express Session (Gerenciamento de sessões)
- Multer (Upload de arquivos)
- BCrypt (Criptografia de senhas)

## Configuração Local

1. Clone o repositório:
```bash
git clone [URL_DO_REPOSITORIO]
cd [NOME_DA_PASTA]
```

2. Instale as dependências:
```bash
npm install
```

3. Configure as variáveis de ambiente:
- Crie um arquivo `.env` na raiz do projeto
- Copie o conteúdo de `.env.example` e preencha com suas configurações

4. Inicie o servidor de desenvolvimento:
```bash
npm run dev
```

## Deploy no Vercel

1. Primeiro, crie uma conta gratuita no [Neon](https://neon.tech) para o banco de dados PostgreSQL:
   - Crie um novo projeto
   - Copie a string de conexão fornecida

2. Instale a CLI do Vercel:
```bash
npm i -g vercel
```

3. Faça login no Vercel:
```bash
vercel login
```

4. Deploy do projeto:
```bash
vercel
```

5. Configure as variáveis de ambiente no Vercel:
   - Acesse [Vercel Dashboard](https://vercel.com)
   - Selecione seu projeto
   - Vá em "Settings" > "Environment Variables"
   - Adicione as seguintes variáveis:
     - `DATABASE_URL` (string de conexão do Neon)
     - `NODE_ENV=production`
     - `SESSION_SECRET` (string aleatória longa)
     - `EMAIL_USER` (seu email Gmail)
     - `EMAIL_PASS` (senha de aplicativo do Gmail)

6. Faça o deploy da produção:
```bash
vercel --prod
```

## Configuração do Email

Para o envio de emails funcionar, você precisa:

1. Ter uma conta Gmail
2. Ativar a verificação em duas etapas
3. Gerar uma senha de aplicativo:
   - Acesse [Senhas de app](https://myaccount.google.com/apppasswords)
   - Selecione "Email" e "Outro"
   - Use a senha gerada na variável `EMAIL_PASS`

## Contribuindo

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/AmazingFeature`)
3. Commit suas mudanças (`git commit -m 'Add some AmazingFeature'`)
4. Push para a branch (`git push origin feature/AmazingFeature`)
5. Abra um Pull Request

## Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes. 