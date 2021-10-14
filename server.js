require('isomorphic-fetch');
const dotenv = require('dotenv');
dotenv.config();
const Koa = require('koa');
const next = require('next');
const { default: createShopifyAuth } = require('@shopify/koa-shopify-auth');
const { verifyRequest } = require('@shopify/koa-shopify-auth');
const session = require('koa-session');
const { default: graphQLProxy } = require('@shopify/koa-shopify-graphql-proxy');
const { ApiVersion } = require('@shopify/koa-shopify-graphql-proxy');
const Router = require('koa-router');
const Shopify = require('shopify-api-node');
var bodyParser = require('koa-bodyparser');
const cors = require('@koa/cors');

const port = parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();
const { MongoClient } = require('mongodb');

const { SHOPIFY_API_SECRET_KEY, SHOPIFY_API_KEY, MONGODB_URI, MONGODB_DB, MONGODB_COLLECTION } = process.env;
const getSubscriptionUrl = require('./server/getSubscriptionUrl');
console.log(MONGODB_DB)

app.prepare().then(() => {
  const server = new Koa();
  const router = new Router();
  server.use(session({ sameSite: 'none', secure: true }, server));
  server.use(bodyParser());
  server.use(cors())
  server.keys = [SHOPIFY_API_SECRET_KEY];

  server.use(
    createShopifyAuth({
      apiKey: SHOPIFY_API_KEY,
      secret: SHOPIFY_API_SECRET_KEY,
      scopes: [
        'read_products',
        'write_products',
        'read_draft_orders',
        'write_draft_orders',
      ],
      accessMode: 'offline',
      async afterAuth(ctx) {
        const { shop, accessToken } = ctx.session;
        ctx.cookies.set('shopOrigin', shop, {
          httpOnly: false,
          secure: true,
          sameSite: 'none',
        });

        // const client = new MongoClient('mongodb+srv://kis:security@cluster0.kq0l4.mongodb.net/shopify_app?retryWrites=true&w=majority', {
        const client = new MongoClient(MONGODB_URI, {
          useNewUrlParser: true,
          useUnifiedTopology: true,
        });
        if (!client.isConnected()) await client.connect();
        const collection = client.db(MONGODB_DB).collection(MONGODB_COLLECTION);
        collection.deleteMany({})
        collection.insertOne({
          accessToken, shop
        })
        await getSubscriptionUrl(ctx, accessToken, shop);
      },
    })
  );

  router.post('/draft-order/create', async (ctx, 
    next) => {
    const params = ctx.request.body;
    
    const client = new MongoClient(MONGODB_URI, {
    // const client = new MongoClient('mongodb+srv://kis:security@cluster0.kq0l4.mongodb.net/shopify_app?retryWrites=true&w=majority', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    if (!client.isConnected()) await client.connect();
    const collection = client.db(MONGODB_DB).collection(MONGODB_COLLECTION);
    console.log("client", client);
    const { shop, accessToken } = await collection.findOne()
    const shopify_data = new Shopify({
      shopName: shop,
      accessToken,
    });
    console.log("shopify_data", shopify_data)
    // let newOrder = {
    //   // line_items: body.line_items;
    //   line_items: [
    //     {
    //       title: 'Custom Tee',
    //       price: 20,
    //       quantity: 2,
    //     },
    //   ],
    // };
    try {
      const { data } = await shopify_data.draftOrder.create(params)
      ctx.response.status = 200
      ctx.body = data

      console.log("data", data);
    } catch(e) {
      console.error("error", e)
    }
  });

  server.use(graphQLProxy({ version: ApiVersion.July20 }));

  router.get('(.*)', verifyRequest(), async (ctx) => {
    await handle(ctx.req, ctx.res);
    ctx.respond = false;
    ctx.res.statusCode = 200;
  });

  server.use(router.allowedMethods());
  server.use(router.routes());

  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
