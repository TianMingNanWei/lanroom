#include "roomserver.h"
#include "room_mgr.h"
#include "rpc_ids.h"

RoomServer::RoomServer()
{
}

RoomServer::~RoomServer()
{
}

const std::string RoomServer::GetIDString()
{
	return "RoomServer";
}

::OI::Rpc::RpcTask RoomServer::HandleJoin(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::JoinReq& stRequest, ::OI::RpcData::JoinRes& stResponse)
{
	co_return co_await RoomMgr::GetInstance().Join(stContext, stRequest, stResponse);
}

::OI::Rpc::RpcTask RoomServer::HandleHeartbeat(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::HeartbeatReq& stRequest, ::OI::RpcData::HeartbeatRes& stResponse)
{
	co_return co_await RoomMgr::GetInstance().Heartbeat(stContext, stRequest, stResponse);
}

::OI::Rpc::RpcTask RoomServer::HandleLeave(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::LeaveReq& stRequest, ::OI::RpcData::LeaveRes& stResponse)
{
	co_return co_await RoomMgr::GetInstance().Leave(stContext, stRequest, stResponse);
}

::OI::Rpc::RpcTask RoomServer::HandleCarry(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::CarryReq& stRequest)
{
	co_return co_await RoomMgr::GetInstance().Carry(stContext, stRequest);
}

int32_t RoomServer::Init()
{
	RoomMgr::GetInstance().Init();
	int32_t iCode = OI_OK;
	if ((iCode = HandleRpc(&RoomServer::HandleJoin)) != OI_OK ||
	    (iCode = HandleRpc(&RoomServer::HandleHeartbeat)) != OI_OK ||
	    (iCode = HandleRpc(&RoomServer::HandleLeave)) != OI_OK ||
	    (iCode = HandleNotify(&RoomServer::HandleCarry)) != OI_OK)
	{
		return iCode;
	}
	return ::OI::Rpc::ProtoSessionManager::Init();
}

void RoomServer::OnAddSession(OI::Net::Session* pSession)
{
	(void)pSession;
}

void RoomServer::OnDelSession(const OI::Net::Session* pSession)
{
	if (pSession != NULL)
	{
		RoomMgr::GetInstance().ReleaseSession(pSession->GetSessionID());
	}
}
