#pragma once
#include "oi_net.h"
#include "oi_rpc_coro.h"
#include "oi_rpcdata_carryreq.h"
#include "oi_rpcdata_roomcastreq.h"
#include "oi_singleton.h"

// 管理服务器 TCP 连接，供 RoomMgr 发送进房、心跳和中转帧。
class RoomClient : public OI::Rpc::ProtoMultiClientManager
{
	DECLARE_SINGLETON(RoomClient)
	RoomClient();

  public:
	~RoomClient() override;
	int32_t Init() override;
	int32_t UseHost(const std::string& sHost);
	const std::string GetIDString() override;

  protected:
	int RetryMilliseconds() const override
	{
		return 1000;
	}

  private:
	bool m_bHandlersBound = false;
	::OI::Rpc::RpcTask HandleRoomCast(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::RoomCastReq& stRequest);
	::OI::Rpc::RpcTask HandleCarry(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::CarryReq& stRequest);
};
