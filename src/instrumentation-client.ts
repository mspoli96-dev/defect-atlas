import { initBotId } from "botid/client/core";

initBotId({protect:[{path:"/api/inspect",method:"POST"}]});
