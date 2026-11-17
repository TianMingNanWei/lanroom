#include "roomclient.h"
#include "room_mgr.h"
#include "rpc_ids.h"

RoomClient::RoomClient()
{
}

RoomClient::~RoomClient()
{
}

const std::string RoomClient::GetIDString()
{
	return "RoomClient";
}

::OI::Rpc::RpcTask RoomClient::HandleRoomCast(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::RoomCastReq& stRequest)
{
	(void)stContext;
	RoomMgr::GetInstance().ApplyCast(stRequest);
	co_return OI_OK;
}

::OI::Rpc::RpcTask RoomClient::HandleCarry(const ::OI::Rpc::RpcContext& stContext, const ::OI::RpcData::CarryReq& stRequest)
{
	(void)stContext;
	co_return RoomMgr::GetInstance().Carried(stRequest);
}

int32_t RoomClient::Init()
{
	int32_t iCode = OI_OK;
	if (!m_bHandlersBound)
	{
		if ((iCode = HandleNotify(&RoomClient::HandleRoomCast)) != OI_OK ||
		    (iCode = HandleNotify(&RoomClient::HandleCarry)) != OI_OK)
		{
			return iCode;
		}
		m_bHandlersBound = true;
	}
	iCode = ::OI::Rpc::ProtoMultiClientManager::Init();
	if (iCode != OI_OK)
	{
		return iCode;
	}
	RoomMgr::GetInstance().Start();
	return OI_OK;
}

void RoomClient::UseHost(const std::string& sHost)
{
	if (sHost.empty())
	{
		return;
	}
	UseAddress(sHost, GetStrPort());
}
