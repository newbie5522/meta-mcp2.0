// @ts-nocheck
import prisma from "../../db/index.js";
import dayjs from "dayjs";

export async function seedSandboxData() {
  console.log("🌱 [Seed Sandbox] Checking if seeding is required...");
  
  const storeCount = await prisma.store.count();
  if (storeCount > 0) {
    console.log("🌱 [Seed Sandbox] Store count is already greater than 0. Skipping sandbox auto-seeding.");
    return;
  }

  console.log("🌱 [Seed Sandbox] Database is empty! Initiating 90-day sandbox data seeding...");

  // 1. Create Default User (if not exists)
  // Admin user check is also handled by checkDb, but let's confirm here
  
  // 2. Create Stores
  const stores = [
    {
      id: 1,
      name: "Shopline Fashion Store",
      platform: "shopline",
      shopline_token: "sl_tok_fashion_9921",
      domain: "fashion.shoplineapp.com",
      visitors: 125000,
      timezone: "GMT+8",
      status: "active",
      mode: "sandbox"
    },
    {
      id: 2,
      name: "Shopify Electronics Hub",
      platform: "shopify",
      shopify_token: "sh_tok_elec_4829",
      domain: "electronics.myshopify.com",
      visitors: 89000,
      timezone: "GMT-5",
      status: "active",
      mode: "sandbox"
    },
    {
      id: 3,
      name: "Shoplazza Home Decor",
      platform: "shoplazza",
      shoplazza_token: "sz_tok_decor_3821",
      domain: "decor.shoplazza.com",
      visitors: 48000,
      timezone: "GMT+8",
      status: "active",
      mode: "sandbox"
    }
  ];

  for (const store of stores) {
    await prisma.store.create({ data: store });
  }
  console.log("🌱 [Seed Sandbox] 3 Stores seeded.");

  // 3. Create AdAccounts
  const adAccounts = [
    {
      id: 1,
      fb_account_id: "act_439281903",
      fb_account_name: "Meta US General Ad Account",
      currency: "USD",
      timezone: "America/New_York",
      status: "1",
      storeId: 1,
      activityStatus: 1,
      recentActivity90d: true
    },
    {
      id: 2,
      fb_account_id: "act_583920194",
      fb_account_name: "Meta EU Scaling Ad Account",
      currency: "EUR",
      timezone: "Europe/Paris",
      status: "1",
      storeId: 2,
      activityStatus: 1,
      recentActivity90d: true
    },
    {
      id: 3,
      fb_account_id: "act_204928103",
      fb_account_name: "Meta Global Testing Ad Account",
      currency: "USD",
      timezone: "Asia/Tokyo",
      status: "1",
      storeId: 3,
      activityStatus: 1,
      recentActivity90d: true
    }
  ];

  for (const acc of adAccounts) {
    await prisma.adAccount.create({ data: acc });
  }
  console.log("🌱 [Seed Sandbox] 3 AdAccounts seeded.");

  // 4. Create Account Mappings
  const mappings = [
    {
      id: 1,
      storeId: 1,
      fbAccountId: "act_439281903",
      fbPageId: "page_948190",
      project: "Fashion Spring Scale",
      owner: "Alexander",
      name: "Fashion -> Meta US",
      mode: "active"
    },
    {
      id: 2,
      storeId: 2,
      fbAccountId: "act_583920194",
      fbPageId: "page_382910",
      project: "Audio Electronics EU",
      owner: "Sarah",
      name: "Electronics -> Meta EU",
      mode: "active"
    },
    {
      id: 3,
      storeId: 3,
      fbAccountId: "act_204928103",
      fbPageId: "page_182931",
      project: "Decor Globals",
      owner: "Kenji",
      name: "Home Decor -> Meta Global",
      mode: "active"
    }
  ];

  for (const mapping of mappings) {
    await prisma.accountMapping.create({ data: mapping });
  }
  console.log("🌱 [Seed Sandbox] 3 Account Mappings seeded.");

  // 5. Create Products
  const products = [
    { id: "prod_fashion_01", storeId: 1, name: "Premium French Linen Shirt", sku: "FL-SHIRT-01", category: "Apparel", inventory: 450 },
    { id: "prod_fashion_02", storeId: 1, name: "Slim Fit Stretch Chino", sku: "CHINO-SLIM-BK", category: "Apparel", inventory: 280 },
    { id: "prod_elec_01", storeId: 2, name: "Noise Cancelling Headphones", sku: "NC-HEAD-01", category: "Electronics", inventory: 120 },
    { id: "prod_elec_02", storeId: 2, name: "Wireless Charging Pad Duo", sku: "WLS-CHGR-02", category: "Electronics", inventory: 500 },
    { id: "prod_decor_01", storeId: 3, name: "Minimalist Ceramic Flower Vase", sku: "CER-VASE-01", category: "Home Goods", inventory: 150 },
    { id: "prod_decor_02", storeId: 3, name: "Handwoven Cotton Throw Blanket", sku: "BLKT-COT-HW", category: "Home Goods", inventory: 95 }
  ];

  for (const prod of products) {
    await prisma.product.create({ data: prod });
  }
  console.log("🌱 [Seed Sandbox] Products seeded.");

  // 6. Create Campaigns, AdSets, Ads
  const campaigns = [
    { id: "C01_USA_LinenShirt_Purchase", accountId: "act_439281903", name: "USA / Conversions / Linen Shirt Campaign", status: "ACTIVE", region: "North America" },
    { id: "C02_EU_Headphones_Purchase", accountId: "act_583920194", name: "Europe / Conversions / Bass Plus Campaign", status: "ACTIVE", region: "Europe" },
    { id: "C03_Global_CeramicVase_Prospects", accountId: "act_204928103", name: "Global / Traffic / Ceramic Vase Prospects Campaign", status: "ACTIVE", region: "Asia Pacific" }
  ];
  for (const c of campaigns) {
    await prisma.campaign.create({ data: c });
  }

  const adsets = [
    { id: "S01_USA_M_30-45", campaignId: "C01_USA_LinenShirt_Purchase", accountId: "act_439281903", name: "US / Males / 30-45" },
    { id: "S02_EU_All_21-35", campaignId: "C02_EU_Headphones_Purchase", accountId: "act_583920194", name: "EU / All Genders / 21-35" },
    { id: "S03_Global_F_25-50", campaignId: "C03_Global_CeramicVase_Prospects", accountId: "act_204928103", name: "Global / Females / 25-50" }
  ];
  for (const s of adsets) {
    await prisma.adSet.create({ data: s });
  }

  const creatives = [
    {
      creativeId: "CR01",
      fbAccountId: "act_439281903",
      mediaType: "VIDEO",
      imageUrl: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400",
      previewUrl: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?w=400",
      storeId: 1,
      name: "CR01 - French Linen Video - Natural Tint",
      type: "video",
      landingUrl: "https://fashion.shoplineapp.com/products/linen-shirt-01",
      metaAssetId: "meta_vid_cr01_hash",
      hookRate: 0.28
    },
    {
      creativeId: "CR02",
      fbAccountId: "act_439281903",
      mediaType: "IMAGE",
      imageUrl: "https://images.unsplash.com/photo-1479064555552-3ef4979f8908?w=400",
      previewUrl: "https://images.unsplash.com/photo-1479064555552-3ef4979f8908?w=400",
      storeId: 1,
      name: "CR02 - Linen Shirt Lifestyle Image",
      type: "image",
      landingUrl: "https://fashion.shoplineapp.com/products/chino-slim-chino",
      metaAssetId: "meta_img_cr02_hash",
      hookRate: 0.12
    },
    {
      creativeId: "CR03",
      fbAccountId: "act_583920194",
      mediaType: "VIDEO",
      imageUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400",
      previewUrl: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400",
      storeId: 2,
      name: "CR03 - Noise Cancelling Video High-Fi",
      type: "video",
      landingUrl: "https://electronics.myshopify.com/products/nc-headphones-01",
      metaAssetId: "meta_vid_cr03_hash",
      hookRate: 0.35
    },
    {
      creativeId: "CR04",
      fbAccountId: "act_204928103",
      mediaType: "IMAGE",
      imageUrl: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=400",
      previewUrl: "https://images.unsplash.com/photo-1578500494198-246f612d3b3d?w=400",
      storeId: 3,
      name: "CR04 - Ceramic Vase Minimalist Aesthetic",
      type: "image",
      landingUrl: "https://decor.shoplazza.com/products/ceramic-vase-01",
      metaAssetId: "meta_img_cr04_hash",
      hookRate: 0.18
    }
  ];
  for (const cr of creatives) {
    await prisma.adCreative.create({ data: cr });
  }

  const ads = [
    { id: "A01_Linen_Video_01", adsetId: "S01_USA_M_30-45", campaignId: "C01_USA_LinenShirt_Purchase", accountId: "439281903", name: "Ad - US - Linen Video Creative 01", creativeId: "CR01" },
    { id: "A02_Linen_Image_02", adsetId: "S01_USA_M_30-45", campaignId: "C01_USA_LinenShirt_Purchase", accountId: "439281903", name: "Ad - US - Linen Lifestyle Image 02", creativeId: "CR02" },
    { id: "A03_Headphones_Video_A", adsetId: "S02_EU_All_21-35", campaignId: "C02_EU_Headphones_Purchase", accountId: "583920194", name: "Ad - EU - Bass Plus Video A", creativeId: "CR03" },
    { id: "A04_Vase_Carousel_B", adsetId: "S03_Global_F_25-50", campaignId: "C03_Global_CeramicVase_Prospects", accountId: "204928103", name: "Ad - Global - Vase Image B", creativeId: "CR04" }
  ];
  for (const ad of ads) {
    await prisma.ad.create({ data: ad });
  }
  console.log("🌱 [Seed Sandbox] Campaign components seeded.");

  // 7. Seed orders and daily insights for the last 90 days
  console.log("🌱 [Seed Sandbox] Generating historical timeline metrics...");
  
  const daysToSeed = 90;
  const startDay = dayjs().subtract(daysToSeed, "day");
  
  let totalSeededOrders = 0;
  let totalSeededInsights = 0;

  for (let i = 0; i < daysToSeed; i++) {
    const currentDay = startDay.add(i, "day");
    const dateStr = currentDay.format("YYYY-MM-DD");
    const dateObj = currentDay.startOf("day").toDate();

    const isWeekend = currentDay.day() === 0 || currentDay.day() === 6;
    const weekendMultiplier = isWeekend ? 1.4 : 1.0;

    // --- STORE 1 (Linen Shirt Shop, high volumes, robust ROAS ~ 2.4 - 3.2) ---
    const s1OrderQty = Math.round((8 + Math.random() * 15) * weekendMultiplier);
    const s1AdSpend = 150 + Math.random() * 100 + (isWeekend ? 50 : 0);
    
    // Seed Store 1 Orders
    let s1Revenue = 0;
    let s1Profit = 0;
    for (let o = 0; o < s1OrderQty; o++) {
      const isShirt = Math.random() > 0.4;
      const prod = isShirt ? products[0] : products[1];
      const rev = isShirt ? (49 + Math.random() * 20) : (69 + Math.random() * 30);
      const prof = rev * 0.7; // high margins for fashion shirts
      s1Revenue += rev;
      s1Profit += prof;

      await prisma.order.create({
        data: {
          id: `order_sl1_${i}_${o}`,
          storeId: 1,
          productId: prod.id,
          revenue: rev,
          profit: prof,
          refunded: Math.random() < 0.03, // 3% refund rate
          orderId: `SL-${100000 + i * 100 + o}`,
          orderTotal: rev,
          createdAt: currentDay.add(Math.round(Math.random() * 20), "hour").toDate()
        }
      });
      totalSeededOrders++;
    }

    // Seed Meta US Account (act_439281903) Insights
    const s1Impressions = Math.round(s1AdSpend * (55 + Math.random() * 15));
    const s1Clicks = Math.round(s1Impressions * (0.018 + Math.random() * 0.015)); // fine CTR ~ 2-3%
    const s1AddToCart = Math.round(s1Clicks * (0.12 + Math.random() * 0.08));
    const s1Checkout = Math.round(s1AddToCart * (0.6 + Math.random() * 0.2));
    const s1Purchases = Math.round(s1Checkout * (0.7 + Math.random() * 0.2));
    const s1PurchaseValue = s1Purchases * (55 + Math.random() * 10);

    await prisma.adInsight.create({
      data: {
        accountId: "439281903",
        date: dateStr,
        accountName: "Meta US General Ad Account",
        reach: Math.round(s1Impressions * 0.8),
        impressions: s1Impressions,
        clicks: s1Clicks,
        spend: s1AdSpend,
        addToCart: s1AddToCart,
        initiateCheckout: s1Checkout,
        purchases: s1Purchases,
        purchaseValue: s1PurchaseValue,
        cpc: s1Clicks > 0 ? s1AdSpend / s1Clicks : 0,
        ctr: s1Impressions > 0 ? (s1Clicks / s1Impressions) * 100 : 0,
        atcRate: s1Clicks > 0 ? s1AddToCart / s1Clicks : 0,
        checkoutRate: s1AddToCart > 0 ? s1Checkout / s1AddToCart : 0,
        cpp: s1Purchases > 0 ? s1AdSpend / s1Purchases : 0,
        roas: s1AdSpend > 0 ? s1PurchaseValue / s1AdSpend : 0
      }
    });
    totalSeededInsights++;

    // Seed Creative performance data for Store 1 (CR01-65%, CR02-35%)
    await prisma.creativePerformanceDaily.create({
      data: {
        creativeId: "CR01",
        date: dateStr,
        spend: s1AdSpend * 0.65,
        impressions: Math.round(s1Impressions * 0.65),
        clicks: Math.round(s1Clicks * 0.70), // higher CTR on video
        revenue: s1PurchaseValue * 0.75, // higher conversion value
        storeId: 1,
        creativeName: "CR01 - French Linen Video - Natural Tint",
        type: "video",
        purchases: Math.round(s1Purchases * 0.75),
        roas: (s1PurchaseValue * 0.75) / (s1AdSpend * 0.65),
        ctr: (s1Clicks * 0.70) / (s1Impressions * 0.65),
        cpc: (s1AdSpend * 0.65) / (s1Clicks * 0.70),
        cpm: ((s1AdSpend * 0.65) / (s1Impressions * 0.65)) * 1000,
        frequency: 1.25,
        hookRate: 0.28,
        aiRiskStatus: s1AdSpend > 240 ? "warning" : "healthy",
        trendStatus: "up",
        aiSuggestion: "视频主打透气特性的细节放大效果卓著，可以追加春夏季高点击词广告费用投放。"
      }
    });

    await prisma.creativePerformanceDaily.create({
      data: {
        creativeId: "CR02",
        date: dateStr,
        spend: s1AdSpend * 0.35,
        impressions: Math.round(s1Impressions * 0.35),
        clicks: Math.round(s1Clicks * 0.30),
        revenue: s1PurchaseValue * 0.25,
        storeId: 1,
        creativeName: "CR02 - Linen Shirt Lifestyle Image",
        type: "image",
        purchases: Math.round(s1Purchases * 0.25),
        roas: (s1PurchaseValue * 0.25) / (s1AdSpend * 0.35),
        ctr: (s1Clicks * 0.30) / (s1Impressions * 0.35),
        cpc: (s1AdSpend * 0.35) / (s1Clicks * 0.30),
        cpm: ((s1AdSpend * 0.35) / (s1Impressions * 0.35)) * 1000,
        frequency: 1.15,
        hookRate: 0.12,
        aiRiskStatus: "healthy",
        trendStatus: "stable",
        aiSuggestion: "静态图表现平稳，主要承接老客人群。建议小额预算维持日常重定向投放即可。"
      }
    });


    // --- STORE 2 (Electronics, high AOV, low ROAS ~ 0.8 - 1.2, trigger alert low roas!) ---
    const s2OrderQty = Math.round((2 + Math.random() * 4) * (isWeekend ? 0.8 : 1.0)); // electronic orders drop on weekends
    const s2AdSpend = 300 + Math.random() * 150; // high cost CPC keyword bidding

    let s2Revenue = 0;
    let s2Profit = 0;
    for (let o = 0; o < s2OrderQty; o++) {
      const isHead = Math.random() > 0.3;
      const prod = isHead ? products[2] : products[3];
      const rev = isHead ? (199 + Math.random() * 40) : (49 + Math.random() * 10);
      const prof = rev * 0.45; // lower margin on high ticket electronics
      s2Revenue += rev;
      s2Profit += prof;

      await prisma.order.create({
        data: {
          id: `order_sl2_${i}_${o}`,
          storeId: 2,
          productId: prod.id,
          revenue: rev,
          profit: prof,
          refunded: Math.random() < 0.05, // 5% refund rate
          orderId: `SL-${200000 + i * 100 + o}`,
          orderTotal: rev,
          createdAt: currentDay.add(Math.round(Math.random() * 20), "hour").toDate()
        }
      });
      totalSeededOrders++;
    }

    // Seed Meta EU Account (act_583920194) Insights
    const s2Impressions = Math.round(s2AdSpend * (25 + Math.random() * 8)); // low impressions due to expensive niche keywords
    const s2Clicks = Math.round(s2Impressions * (0.009 + Math.random() * 0.006)); // sparse click-through rates
    const s2AddToCart = Math.round(s2Clicks * (0.05 + Math.random() * 0.04));
    const s2Checkout = Math.round(s2AddToCart * (0.5 + Math.random() * 0.1));
    const s2Purchases = Math.round(s2Checkout * (0.5 + Math.random() * 0.1));
    const s2PurchaseValue = s2Purchases * (180 + Math.random() * 30);

    await prisma.adInsight.create({
      data: {
        accountId: "583920194",
        date: dateStr,
        accountName: "Meta EU Scaling Ad Account",
        reach: Math.round(s2Impressions * 0.82),
        impressions: s2Impressions,
        clicks: s2Clicks,
        spend: s2AdSpend,
        addToCart: s2AddToCart,
        initiateCheckout: s2Checkout,
        purchases: s2Purchases,
        purchaseValue: s2PurchaseValue,
        cpc: s2Clicks > 0 ? s2AdSpend / s2Clicks : 0,
        ctr: s2Impressions > 0 ? (s2Clicks / s2Impressions) * 100 : 0,
        atcRate: s2Clicks > 0 ? s2AddToCart / s2Clicks : 0,
        checkoutRate: s2AddToCart > 0 ? s2Checkout / s2AddToCart : 0,
        cpp: s2Purchases > 0 ? s2AdSpend / s2Purchases : 0,
        roas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0
      }
    });
    totalSeededInsights++;

    // Seed Creative Performance daily (CR03 Electronic Video)
    await prisma.creativePerformanceDaily.create({
      data: {
        creativeId: "CR03",
        date: dateStr,
        spend: s2AdSpend,
        impressions: s2Impressions,
        clicks: s2Clicks,
        revenue: s2PurchaseValue,
        storeId: 2,
        creativeName: "CR03 - Noise Cancelling Video High-Fi",
        type: "video",
        purchases: s2Purchases,
        roas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0,
        ctr: s2Impressions > 0 ? s2Clicks / s2Impressions : 0,
        cpc: s2Clicks > 0 ? s2AdSpend / s2Clicks : 0,
        cpm: s2Impressions > 0 ? (s2AdSpend / s2Impressions) * 1000 : 0,
        frequency: 1.4,
        hookRate: 0.35,
        aiRiskStatus: "danger", // alarm because of poor ROAS
        trendStatus: "down",
        aiSuggestion: "此高保真视频物料ROAS已经跌破1.0。由于CPC关键词竞价成本极高（$3.5以上），继续投放造成严重赤字。建议立即针对该系列收紧竞价策略，过滤展示频次过高（>1.4）的重叠受众。"
      }
    });

    // --- STORE 3 (Home Decor, scale prospects, ROAS ~ 1.5 - 2.0) ---
    const s3OrderQty = Math.round((3 + Math.random() * 6) * weekendMultiplier);
    const s3AdSpend = 80 + Math.random() * 40;

    let s3Revenue = 0;
    let s3Profit = 0;
    for (let o = 0; o < s3OrderQty; o++) {
      const isVase = Math.random() > 0.4;
      const prod = isVase ? products[4] : products[5];
      const rev = isVase ? (35 + Math.random() * 10) : (59 + Math.random() * 15);
      const prof = rev * 0.55;
      s3Revenue += rev;
      s3Profit += prof;

      await prisma.order.create({
        data: {
          id: `order_sl3_${i}_${o}`,
          storeId: 3,
          productId: prod.id,
          revenue: rev,
          profit: prof,
          refunded: Math.random() < 0.02,
          orderId: `SL-${300000 + i * 100 + o}`,
          orderTotal: rev,
          createdAt: currentDay.add(Math.round(Math.random() * 20), "hour").toDate()
        }
      });
      totalSeededOrders++;
    }

    // Seed Meta JP Account (act_204928103) Insights
    const s3Impressions = Math.round(s3AdSpend * (45 + Math.random() * 12));
    const s3Clicks = Math.round(s3Impressions * (0.015 + Math.random() * 0.009));
    const s3AddToCart = Math.round(s3Clicks * (0.08 + Math.random() * 0.05));
    const s3Checkout = Math.round(s3AddToCart * (0.55 + Math.random() * 0.15));
    const s3Purchases = Math.round(s3Checkout * (0.65 + Math.random() * 0.15));
    const s3PurchaseValue = s3Purchases * (46 + Math.random() * 8);

    await prisma.adInsight.create({
      data: {
        accountId: "204928103",
        date: dateStr,
        accountName: "Meta Global Testing Ad Account",
        reach: Math.round(s3Impressions * 0.81),
        impressions: s3Impressions,
        clicks: s3Clicks,
        spend: s3AdSpend,
        addToCart: s3AddToCart,
        initiateCheckout: s3Checkout,
        purchases: s3Purchases,
        purchaseValue: s3PurchaseValue,
        cpc: s3Clicks > 0 ? s3AdSpend / s3Clicks : 0,
        ctr: s3Impressions > 0 ? (s3Clicks / s3Impressions) * 100 : 0,
        atcRate: s3Clicks > 0 ? s3AddToCart / s3Clicks : 0,
        checkoutRate: s3AddToCart > 0 ? s3Checkout / s3AddToCart : 0,
        cpp: s3Purchases > 0 ? s3AdSpend / s3Purchases : 0,
        roas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0
      }
    });
    totalSeededInsights++;

    // Seed Creative performance data for Store 3 (CR04 Vase Image)
    await prisma.creativePerformanceDaily.create({
      data: {
        creativeId: "CR04",
        date: dateStr,
        spend: s3AdSpend,
        impressions: s3Impressions,
        clicks: s3Clicks,
        revenue: s3PurchaseValue,
        storeId: 3,
        creativeName: "CR04 - Ceramic Vase Minimalist Aesthetic",
        type: "image",
        purchases: s3Purchases,
        roas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0,
        ctr: s3Impressions > 0 ? s3Clicks / s3Impressions : 0,
        cpc: s3Clicks > 0 ? s3AdSpend / s3Clicks : 0,
        cpm: s3Impressions > 0 ? (s3AdSpend / s3Impressions) * 1000 : 0,
        frequency: 1.2,
        hookRate: 0.18,
        aiRiskStatus: "healthy",
        trendStatus: "stable",
        aiSuggestion: "陶瓷花瓶物料视觉风格深受文艺女性顾客青睐，ROAS在平衡点1.5以上波荡。建议增加15%预算投入。"
      }
    });

    // --- SEED DAILY PRODUCT PERFORMANCE (For Product Intelligence dashboard!) ---
    // Products 0 and 1 (Store 1)
    const sl1OrdersProd0 = s1OrderQty > 0 ? Math.round(s1OrderQty * 0.6) : 0;
    const sl1OrdersProd1 = s1OrderQty > sl1OrdersProd0 ? s1OrderQty - sl1OrdersProd0 : 0;
    
    await prisma.productPerformanceDaily.create({
      data: {
        date: dateStr,
        storeId: 1,
        productId: "prod_fashion_01",
        productName: "Premium French Linen Shirt",
        sku: "FL-SHIRT-01",
        category: "Apparel",
        revenue: sl1OrdersProd0 * 59.9,
        orders: sl1OrdersProd0,
        profit: sl1OrdersProd0 * 59.9 * 0.7,
        adSpend: s1AdSpend * 0.65,
        productRoas: (s1AdSpend * 0.65) > 0 ? (sl1OrdersProd0 * 59.9) / (s1AdSpend * 0.65) : 0,
        profitRoas: (s1AdSpend * 0.65) > 0 ? (sl1OrdersProd0 * 59.9 * 0.7) / (s1AdSpend * 0.65) : 0,
        ctr: s1Clicks / s1Impressions,
        cpc: s1Clicks > 0 ? s1AdSpend / s1Clicks : 0,
        cpm: s1Impressions > 0 ? (s1AdSpend / s1Impressions) * 1000 : 0,
        frequency: 1.25,
        refundRate: 0.02,
        inventory: 450 - i,
        topRegion: "California, US",
        topCampaign: "C01_USA_LinenShirt_Purchase",
        topCreative: "CR01",
        aiRiskStatus: "healthy",
        trendStatus: "up",
        aiSuggestion: "法式亚麻衬衫日均订单平稳上升。物料展现高吸引力，投产转化良好，可考虑对服装核心城市做区域性高投预算倾斜。"
      }
    });

    await prisma.productPerformanceDaily.create({
      data: {
        date: dateStr,
        storeId: 1,
        productId: "prod_fashion_02",
        productName: "Slim Fit Stretch Chino",
        sku: "CHINO-SLIM-BK",
        category: "Apparel",
        revenue: sl1OrdersProd1 * 79.9,
        orders: sl1OrdersProd1,
        profit: sl1OrdersProd1 * 79.9 * 0.65,
        adSpend: s1AdSpend * 0.35,
        productRoas: (s1AdSpend * 0.35) > 0 ? (sl1OrdersProd1 * 79.9) / (s1AdSpend * 0.35) : 0,
        profitRoas: (s1AdSpend * 0.35) > 0 ? (sl1OrdersProd1 * 79.9 * 0.65) / (s1AdSpend * 0.35) : 0,
        ctr: s1Clicks / s1Impressions,
        cpc: s1Clicks > 0 ? s1AdSpend / s1Clicks : 0,
        cpm: s1Impressions > 0 ? (s1AdSpend / s1Impressions) * 1000 : 0,
        frequency: 1.15,
        refundRate: 0.04,
        inventory: 280 - Math.round(i * 0.5),
        topRegion: "Texas, US",
        topCampaign: "C01_USA_LinenShirt_Purchase",
        topCreative: "CR02",
        aiRiskStatus: "healthy",
        trendStatus: "stable",
        aiSuggestion: "紧身弹力休闲裤表现正常，无重大风险点。由于该产品生命周期偏长，建议做长尾流量重定向维护。"
      }
    });

    // Products 2 and 3 (Store 2)
    const sl2OrdersProd2 = s2OrderQty > 0 ? Math.round(s2OrderQty * 0.7) : 0;
    const sl2OrdersProd3 = s2OrderQty > sl2OrdersProd2 ? s2OrderQty - sl2OrdersProd2 : 0;

    await prisma.productPerformanceDaily.create({
      data: {
        date: dateStr,
        storeId: 2,
        productId: "prod_elec_01",
        productName: "Noise Cancelling Headphones",
        sku: "NC-HEAD-01",
        category: "Electronics",
        revenue: sl2OrdersProd2 * 219.0,
        orders: sl2OrdersProd2,
        profit: sl2OrdersProd2 * 219.0 * 0.45,
        adSpend: s2AdSpend * 0.8,
        productRoas: (s2AdSpend * 0.8) > 0 ? (sl2OrdersProd2 * 219.0) / (s2AdSpend * 0.8) : 0,
        profitRoas: (s2AdSpend * 0.8) > 0 ? (sl2OrdersProd2 * 219.0 * 0.45) / (s2AdSpend * 0.8) : 0,
        ctr: s2Clicks / s2Impressions,
        cpc: s2Clicks > 0 ? s2AdSpend / s2Clicks : 0,
        cpm: s2Impressions > 0 ? (s2AdSpend / s2Impressions) * 1000 : 0,
        frequency: 1.4,
        refundRate: 0.06,
        inventory: 120 - Math.round(i * 0.3),
        topRegion: "Paris, FR",
        topCampaign: "C02_EU_Headphones_Purchase",
        topCreative: "CR03",
        aiRiskStatus: "danger",
        trendStatus: "down",
        aiSuggestion: "降噪耳机广告转化成本过高。极高获客花费正不断侵蚀该电子品类偏低的利润。建议转为品牌词防御投放，或改进页面承接，以防财务大幅出血。"
      }
    });

    await prisma.productPerformanceDaily.create({
      data: {
        date: dateStr,
        storeId: 2,
        productId: "prod_elec_02",
        productName: "Wireless Charging Pad Duo",
        sku: "WLS-CHGR-02",
        category: "Electronics",
        revenue: sl2OrdersProd3 * 49.0,
        orders: sl2OrdersProd3,
        profit: sl2OrdersProd3 * 49.0 * 0.5,
        adSpend: s2AdSpend * 0.2,
        productRoas: (s2AdSpend * 0.2) > 0 ? (sl2OrdersProd3 * 49.0) / (s2AdSpend * 0.2) : 0,
        profitRoas: (s2AdSpend * 0.2) > 0 ? (sl2OrdersProd3 * 49.0 * 0.5) / (s2AdSpend * 0.2) : 0,
        ctr: s2Clicks / s2Impressions,
        cpc: s2Clicks > 0 ? s2AdSpend / s2Clicks : 0,
        cpm: s2Impressions > 0 ? (s2AdSpend / s2Impressions) * 1000 : 0,
        frequency: 1.2,
        refundRate: 0.03,
        inventory: 500 - i,
        topRegion: "Munich, DE",
        topCampaign: "C02_EU_Headphones_Purchase",
        topCreative: "CR03",
        aiRiskStatus: "healthy",
        trendStatus: "stable",
        aiSuggestion: "双向无线充电底座表现良好。可以尝试在此类高频易耗品类上，通过捆绑优惠券和降噪耳机成套推销，提升客单价。"
      }
    });

    // Seed campaign daily summaries
    // Campaign 1
    await prisma.dailySummary.create({
      data: {
        scope: "campaign",
        scopeId: "C01_USA_LinenShirt_Purchase",
        date: dateStr,
        spend: s1AdSpend,
        revenue: s1PurchaseValue,
        orders: s1Purchases,
        clicks: s1Clicks,
        impressions: s1Impressions,
        metaRoas: s1AdSpend > 0 ? s1PurchaseValue / s1AdSpend : 0,
        roas: s1AdSpend > 0 ? s1PurchaseValue / s1AdSpend : 0
      }
    });

    // Campaign 2
    await prisma.dailySummary.create({
      data: {
        scope: "campaign",
        scopeId: "C02_EU_Headphones_Purchase",
        date: dateStr,
        spend: s2AdSpend,
        revenue: s2PurchaseValue,
        orders: s2Purchases,
        clicks: s2Clicks,
        impressions: s2Impressions,
        metaRoas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0,
        roas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0
      }
    });

    // Campaign 3
    await prisma.dailySummary.create({
      data: {
        scope: "campaign",
        scopeId: "C03_Global_CeramicVase_Prospects",
        date: dateStr,
        spend: s3AdSpend,
        revenue: s3PurchaseValue,
        orders: s3Purchases,
        clicks: s3Clicks,
        impressions: s3Impressions,
        metaRoas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0,
        roas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0
      }
    });

    // Seed AdSet Daily Summaries
    await prisma.dailySummary.create({
      data: {
        scope: "adset",
        scopeId: "S01_USA_M_30-45",
        date: dateStr,
        spend: s1AdSpend,
        revenue: s1PurchaseValue,
        orders: s1Purchases,
        clicks: s1Clicks,
        impressions: s1Impressions,
        metaRoas: s1AdSpend > 0 ? s1PurchaseValue / s1AdSpend : 0,
        roas: s1AdSpend > 0 ? s1PurchaseValue / s1AdSpend : 0
      }
    });
    
    await prisma.dailySummary.create({
      data: {
        scope: "adset",
        scopeId: "S02_EU_All_21-35",
        date: dateStr,
        spend: s2AdSpend,
        revenue: s2PurchaseValue,
        orders: s2Purchases,
        clicks: s2Clicks,
        impressions: s2Impressions,
        metaRoas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0,
        roas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0
      }
    });

    await prisma.dailySummary.create({
      data: {
        scope: "adset",
        scopeId: "S03_Global_F_25-50",
        date: dateStr,
        spend: s3AdSpend,
        revenue: s3PurchaseValue,
        orders: s3Purchases,
        clicks: s3Clicks,
        impressions: s3Impressions,
        metaRoas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0,
        roas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0
      }
    });

    // Seed Ad Daily Summaries
    await prisma.dailySummary.create({
      data: {
        scope: "ad",
        scopeId: "A01_Linen_Video_01",
        date: dateStr,
        spend: s1AdSpend * 0.65,
        revenue: s1PurchaseValue * 0.75,
        orders: Math.round(s1Purchases * 0.75),
        clicks: Math.round(s1Clicks * 0.70),
        impressions: Math.round(s1Impressions * 0.65),
        metaRoas: (s1AdSpend * 0.65) > 0 ? (s1PurchaseValue * 0.75) / (s1AdSpend * 0.65) : 0,
        roas: (s1AdSpend * 0.65) > 0 ? (s1PurchaseValue * 0.75) / (s1AdSpend * 0.65) : 0
      }
    });

    await prisma.dailySummary.create({
      data: {
        scope: "ad",
        scopeId: "A02_Linen_Image_02",
        date: dateStr,
        spend: s1AdSpend * 0.35,
        revenue: s1PurchaseValue * 0.25,
        orders: Math.round(s1Purchases * 0.25),
        clicks: Math.round(s1Clicks * 0.30),
        impressions: Math.round(s1Impressions * 0.35),
        metaRoas: (s1AdSpend * 0.35) > 0 ? (s1PurchaseValue * 0.25) / (s1AdSpend * 0.35) : 0,
        roas: (s1AdSpend * 0.35) > 0 ? (s1PurchaseValue * 0.25) / (s1AdSpend * 0.35) : 0
      }
    });

    await prisma.dailySummary.create({
      data: {
        scope: "ad",
        scopeId: "A03_Headphones_Video_A",
        date: dateStr,
        spend: s2AdSpend,
        revenue: s2PurchaseValue,
        orders: s2Purchases,
        clicks: s2Clicks,
        impressions: s2Impressions,
        metaRoas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0,
        roas: s2AdSpend > 0 ? s2PurchaseValue / s2AdSpend : 0
      }
    });

    await prisma.dailySummary.create({
      data: {
        scope: "ad",
        scopeId: "A04_Vase_Carousel_B",
        date: dateStr,
        spend: s3AdSpend,
        revenue: s3PurchaseValue,
        orders: s3Purchases,
        clicks: s3Clicks,
        impressions: s3Impressions,
        metaRoas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0,
        roas: s3AdSpend > 0 ? s3PurchaseValue / s3AdSpend : 0
      }
    });

  }

  console.log(`🌱 [Seed Sandbox] Finished generating timeline metrics. Total orders placed: ${totalSeededOrders}, total ad insights generated: ${totalSeededInsights}`);

  // Create simple setting indicator
  await prisma.setting.create({
    data: { key: "meta_accounts_last_synced_at", value: new Date().toISOString() }
  });
  
  await prisma.syncLog.create({
    data: {
      type: "SANDBOX_AUTO_SEED",
      status: "SUCCESS",
      recordsFetched: totalSeededOrders + totalSeededInsights,
      recordsSaved: totalSeededOrders + totalSeededInsights,
      metadata: JSON.stringify({ seededDays: daysToSeed, totalOrders: totalSeededOrders, totalInsights: totalSeededInsights })
    }
  });

  console.log("🌱 [Seed Sandbox] Complete!");
}
